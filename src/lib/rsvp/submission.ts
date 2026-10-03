import { z } from "zod";
import {
  answerField,
  attendanceField,
  extraField,
  guestField,
  type DoneSummary,
  type FieldErrors,
  type RsvpFormModel,
} from "./form";
import type { PayloadPerson, SubmitPayload } from "./types";

/**
 * Převod odeslaného formuláře na obsah pro databázi (a zpět na shrnutí pro potvrzení).
 * Čistý modul. Důvěryhodný je jen `model`, který server sám sestavil z databáze (hosté domácnosti
 * z lístku, jejich pozvání, zapnuté otázky); z formuláře se čtou jen odpovědi, nikdy identifikátory
 * hostů ani událostí mimo model. Databáze obsah ověří ještě jednou (`app.rsvp_apply`).
 */

export const MAX_EXTRAS = 20;
const MAX_NAME = 200;
const MAX_HEALTH = 1000;
const MAX_SONG = 200;
const MAX_ANSWER = 1000;
const MAX_AGE = 17;

const emailSchema = z.email().max(254);

export type ParseResult =
  | { ok: true; payload: SubmitPayload; summary: Omit<DoneSummary, "emailSent"> }
  | { ok: false; errors: FieldErrors };

function read(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function attendanceOf(form: FormData, field: string): boolean | null {
  const value = read(form, field);
  return value === "yes" ? true : value === "no" ? false : null;
}

/** Indexy ručně doplněných osob (`x.0`, `x.1`, ...) v pořadí z formuláře. */
function extraIndexes(form: FormData): number[] {
  const found = new Set<number>();
  for (const key of form.keys()) {
    const match = /^x\.(\d{1,2})\./.exec(key);
    if (match) found.add(Number(match[1]));
  }
  return [...found].sort((a, b) => a - b).slice(0, MAX_EXTRAS);
}

export function parseSubmission(form: FormData, model: RsvpFormModel): ParseResult {
  const errors: FieldErrors = {};
  const people: PayloadPerson[] = [];
  const summary: Omit<DoneSummary, "emailSent"> = {
    people: [],
    unlisted: model.mode === "unlisted",
  };
  const eventTitle = new Map(model.events.map((event) => [event.id, event.title]));
  const attendingEvents = new Set<string>();

  const health = (prefix: string): Pick<PayloadPerson, "diet" | "allergies" | "keep_health"> => {
    if (!model.flags.diet) return {};
    const result: Pick<PayloadPerson, "diet" | "allergies"> = {};
    for (const field of ["diet", "allergies"] as const) {
      const value = read(form, `${prefix}.${field}`);
      if (value.length > MAX_HEALTH) errors[`${prefix}.${field}`] = "too_long";
      else if (value !== "") result[field] = value;
    }
    // Uložené údaje, které host neviděl: bez nových hodnot se ponechají, pokud je výslovně nesmazal.
    const empty = result.diet === undefined && result.allergies === undefined;
    if (
      empty &&
      read(form, `${prefix}.savedHealth`) === "1" &&
      read(form, `${prefix}.clearHealth`) === ""
    ) {
      return { keep_health: true };
    }
    return result;
  };

  // 1. hosté ze seznamu: účast na každé pozvané události
  for (const guest of model.guests) {
    const prefix = guestField(guest.id);
    const attendance: PayloadPerson["attendance"] = [];
    const rows: DoneSummary["people"][number]["rows"] = [];
    for (const eventId of guest.eventIds) {
      const field = attendanceField(prefix, eventId);
      const attending = attendanceOf(form, field);
      if (attending === null) {
        errors[field] = "required";
        continue;
      }
      attendance.push({ event_id: eventId, attending });
      rows.push({ event: eventTitle.get(eventId) ?? "", attending });
      if (attending) attendingEvents.add(eventId);
    }
    people.push({ guest_id: guest.id, attendance, ...health(prefix) });
    summary.people.push({ name: guest.name, rows });
  }

  // 2. doprovod, děti doplněné hostem, hosté mimo seznam
  const indexes = extraIndexes(form);
  const allowedAdults = model.mode === "unlisted" ? MAX_EXTRAS : model.flags.plusOne ? 1 : 0;
  let adults = 0;
  if (model.mode === "unlisted" && indexes.length === 0) {
    errors[`${extraField(0)}.name`] = "name";
  }
  for (const index of indexes) {
    const prefix = extraField(index);
    const kind = read(form, `${prefix}.kind`) === "child" ? "child" : "adult";
    if (kind === "child" ? !model.flags.children : ++adults > allowedAdults) {
      errors[`${prefix}.kind`] = "invalid";
      continue;
    }

    const name = read(form, `${prefix}.name`);
    if (name === "" || name.length > MAX_NAME) errors[`${prefix}.name`] = "name";

    let age: number | null = null;
    if (kind === "child") {
      const raw = read(form, `${prefix}.age`);
      const parsed = /^\d{1,2}$/.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isInteger(parsed) || parsed > MAX_AGE) errors[`${prefix}.age`] = "age";
      else age = parsed;
    }

    const attendance: PayloadPerson["attendance"] = [];
    const rows: DoneSummary["people"][number]["rows"] = [];
    for (const event of model.events) {
      const field = attendanceField(prefix, event.id);
      const attending = attendanceOf(form, field);
      if (attending === null) {
        errors[field] = "required";
        continue;
      }
      attendance.push({ event_id: event.id, attending });
      rows.push({ event: event.title, attending });
      if (attending) attendingEvents.add(event.id);
    }
    people.push({
      guest_id: null,
      person_name: name,
      ...(kind === "child" ? { is_child: true, age } : {}),
      attendance,
      ...health(prefix),
    });
    summary.people.push({ name, rows });
  }

  // 3. otázky: vestavěné (nepovinné) a vlastní (podle zadání páru)
  const answers: SubmitPayload["answers"] = {};
  const choice = (key: string, allowed: readonly string[]) => {
    const value = read(form, answerField(key));
    if (value === "") return;
    if (allowed.includes(value)) answers[key] = value;
    else errors[answerField(key)] = "choice";
  };
  if (model.flags.lodging) choice("lodging", ["need", "own", "unsure"]);
  if (model.flags.transport) choice("transport", ["need", "own", "offer"]);
  if (model.flags.song) {
    const song = read(form, answerField("song"));
    if (song.length > MAX_SONG) errors[answerField("song")] = "too_long";
    else if (song !== "") answers.song = song;
  }
  for (const question of model.questions) {
    // Otázka k události se týká jen toho, kdo na ni přijde.
    if (question.eventId !== null && !attendingEvents.has(question.eventId)) continue;
    const field = answerField(question.key);
    const value = read(form, field);
    if (value === "") {
      if (question.required) errors[field] = "required";
      continue;
    }
    if (question.type === "text") {
      if (value.length > MAX_ANSWER) errors[field] = "too_long";
      else answers[question.key] = value;
    } else if (question.type === "bool") {
      if (value === "yes" || value === "no") answers[question.key] = value === "yes";
      else errors[field] = "choice";
    } else if (question.options.some((option) => option.value === value)) {
      answers[question.key] = value;
    } else {
      errors[field] = "choice";
    }
  }

  // 4. e-mail pro potvrzení (jen když ho pár zapnul)
  let contactEmail: string | null = null;
  let keepEmail = false;
  if (model.flags.emailConfirmation) {
    const email = read(form, "email");
    if (email !== "") {
      if (emailSchema.safeParse(email).success) contactEmail = email;
      else errors.email = "email";
    } else {
      // uložený e-mail, který host neviděl: prázdné pole ho ponechá
      keepEmail = read(form, "emailSaved") === "1";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      contact_email: contactEmail,
      ...(keepEmail ? { keep_email: true } : {}),
      answers,
      people,
    },
    summary,
  };
}
