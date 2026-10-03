import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireEnv } from "@/env";
import type { Defer } from "@/auth/login";
import { RATE_RULES, type RateRule } from "@/auth/config";
import { rateKey } from "@/auth/rate-limit";
import { type Locale, localePath } from "@/i18n/config";
import { authSessionContext, rateLimitHit } from "@/lib/db/rpc";
import { sendTemplatedEmail } from "@/lib/email/send";
import { renderRsvpConfirmation } from "@/lib/email/templates";
import { recordRsvpCompleted } from "./analytics";
import {
  fetchHouseholdView,
  fetchUnlistedForm,
  matchName,
  submitHousehold,
  submitUnlisted,
} from "./db";
import {
  buildListedModel,
  buildUnlistedModel,
  type DoneSummary,
  type RsvpFormModel,
  type RsvpState,
} from "./form";
import { parseSubmission } from "./submission";

/**
 * Průběh RSVP hosta (FR-RSVP-1 až 7): slepé ověření jména, vyplnění, odeslání, úprava. Zásady:
 *  - ověření jména nikdy neprozradí, co je v seznamu: žádná shoda, více shod, překročený limit
 *    i zavřené RSVP dávají stejný stav `not_found` (ADR 0010),
 *  - v prohlížeči není nic z jiné domácnosti než té, kterou otevřel lístek,
 *  - omezení počtu požadavků selže otevřeně (RSVP se nesmí zablokovat výpadkem čítačů, ADR 0010);
 *    zbývá skrytá past a omezení v databázi,
 *  - dietní a alergické údaje nejdou do e-mailu, logu, analytiky ani chyb.
 * Cookie (lístek) řeší volající Server Action; tady jen lístek jako text.
 */

/** Výsledek kroku: nový stav a co dělat s lístkem (uložit do cookie, smazat, nechat). */
export interface StepResult {
  state: RsvpState;
  ticket?: { set: string } | { clear: true };
}

/** Počítadlo omezení; chyba úložiště znamená "povoleno" (RSVP selže otevřeně). */
async function allowed(scope: string, value: string, rule: RateRule): Promise<boolean> {
  try {
    const hit = await rateLimitHit(
      rateKey(requireEnv("RATE_LIMIT_SECRET"), scope, value),
      rule.limit,
      rule.windowSeconds,
    );
    return hit.allowed;
  } catch (error) {
    console.error(
      "[rsvp] počítadlo omezení selhalo, pokračuji",
      error instanceof Error ? error.name : "",
    );
    return true;
  }
}

const MAX_NAME_LENGTH = 200;

/** Krok 1: jméno -> domácnost (lístek) nebo `not_found`. */
export async function matchStep(input: {
  weddingId: string;
  slug: string;
  ip: string;
  name: string;
  locale: Locale;
  /** Skrytá past: vyplněné pole vidí jen robot. */
  honeypot: string;
}): Promise<StepResult> {
  const name = input.name.trim();
  if (name === "") return { state: { stage: "name", error: "name_required", value: "" } };
  const notFound: StepResult = { state: { stage: "name", error: "not_found", value: name } };

  const where = `${input.slug}\0${input.ip}`;
  const permitted = await allowed("rsvp-match", where, RATE_RULES.rsvpMatch);
  // Robot a překročený limit dostanou stejnou odpověď jako host, který v seznamu není.
  if (input.honeypot !== "" || !permitted || name.length > MAX_NAME_LENGTH) return notFound;

  const ticket = await matchName(input.weddingId, name);
  if (ticket === null) return notFound;
  const view = await fetchHouseholdView(input.weddingId, ticket);
  if (view === null) return notFound;

  return {
    state: { stage: "form", model: buildListedModel(view, input.locale) },
    ticket: { set: ticket },
  };
}

/** Host mimo seznam: formulář bez ověření jména (jen když to pár povolil a RSVP je otevřené). */
export async function unlistedStep(input: {
  weddingId: string;
  locale: Locale;
}): Promise<StepResult> {
  const view = await fetchUnlistedForm(input.weddingId);
  if (view === null) return { state: { stage: "name", error: "generic" } };
  return { state: { stage: "form", model: buildUnlistedModel(view, input.locale) } };
}

/** Stav po načtení stránky: platný lístek v cookie otevře formulář s dřívější odpovědí. */
export async function initialState(input: {
  weddingId: string;
  ticket: string | null;
  locale: Locale;
}): Promise<{ state: RsvpState; staleTicket: boolean }> {
  if (!input.ticket) return { state: { stage: "name" }, staleTicket: false };
  const view = await fetchHouseholdView(input.weddingId, input.ticket);
  if (view === null) return { state: { stage: "name" }, staleTicket: true };
  return {
    state: { stage: "form", model: buildListedModel(view, input.locale) },
    staleTicket: false,
  };
}

/** Odeslání nebo úprava odpovědi. `ticket` je `null` u hosta mimo seznam. */
export async function submitStep(input: {
  weddingId: string;
  slug: string;
  ip: string;
  mode: "listed" | "unlisted";
  ticket: string | null;
  form: FormData;
  locale: Locale;
  /** Původ webu páru (`https://klara-a-matej.se-vezmou.cz`) pro odkaz v potvrzení e-mailem. */
  origin: string;
  defer: Defer;
}): Promise<StepResult> {
  const honeypot = input.form.get("website");
  const where = `${input.slug}\0${input.ip}`;
  const [byIp, byWedding] = await Promise.all([
    allowed("rsvp-submit-ip", where, RATE_RULES.rsvpSubmitIp),
    allowed("rsvp-submit-wedding", input.slug, RATE_RULES.rsvpSubmitWedding),
  ]);

  // Robot: odpověď vypadá přijatá, nic se nezapíše.
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    return {
      state: {
        stage: "form",
        done: { people: [], emailSent: false, unlisted: input.mode === "unlisted" },
      },
    };
  }
  if (!byIp || !byWedding) return { state: { stage: "form", error: "limited" } };

  // Důvěryhodný model: znovu z databáze, ne z toho, co poslal prohlížeč.
  let model: RsvpFormModel;
  let firstResponse = true;
  if (input.mode === "listed") {
    if (!input.ticket) return expired();
    const view = await fetchHouseholdView(input.weddingId, input.ticket);
    if (view === null) return expired();
    model = buildListedModel(view, input.locale);
    firstResponse = view.response === null;
  } else {
    const view = await fetchUnlistedForm(input.weddingId);
    if (view === null) return { state: { stage: "closed" } };
    model = buildUnlistedModel(view, input.locale);
  }

  const parsed = parseSubmission(input.form, model);
  if (!parsed.ok) return { state: { stage: "form", error: "invalid", errors: parsed.errors } };

  // Odpověď hosta mimo seznam nese idempotenční klíč z prohlížeče (dvojklik, opakování po výpadku sítě);
  // bez platného klíče (starší stránka) se vygeneruje nový, takže ochrana jen chybí, odpověď se neztratí.
  const nonce = parseNonce(input.form.get("nonce")) ?? randomUUID();
  const outcome =
    input.mode === "listed"
      ? await submitHousehold(input.weddingId, input.ticket as string, parsed.payload)
      : await submitUnlisted(input.weddingId, { ...parsed.payload, nonce });
  if (!outcome.ok) {
    switch (outcome.reason) {
      case "closed":
        return { state: { stage: "closed" }, ticket: { clear: true } };
      case "ticket":
        return expired();
      case "unlisted":
        return { state: { stage: "name", error: "generic" } };
      case "invalid":
        return { state: { stage: "form", error: "invalid" } };
    }
  }

  // Opakované odeslání téhož formuláře: host vidí stejné potvrzení, ale nic se nepočítá ani neposílá podruhé.
  const duplicate = outcome.duplicate;
  if (firstResponse && !duplicate) input.defer(() => recordRsvpCompleted(input.locale));

  // Ponechaný e-mail (host ho neviděl) dostane potvrzení úpravy stejně jako nově zadaný.
  const email = parsed.payload.contact_email ?? outcome.keptEmail ?? null;
  const emailSent = email !== null && model.flags.emailConfirmation;
  if (emailSent && !duplicate) {
    input.defer(() =>
      sendConfirmation({
        weddingId: input.weddingId,
        to: email,
        locale: input.locale,
        summary: parsed.summary,
        origin: input.origin,
      }),
    );
  }
  const done: DoneSummary = { ...parsed.summary, emailSent };

  if (input.mode === "listed") {
    // Po uložení se model načte znovu: formulář ukazuje přesně to, co je v databázi (úprava).
    const view = await fetchHouseholdView(input.weddingId, input.ticket as string);
    if (view !== null) {
      return { state: { stage: "form", model: buildListedModel(view, input.locale), done } };
    }
  }
  return { state: { stage: "form", done } };
}

function parseNonce(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && z.guid().safeParse(value).success ? value : null;
}

function expired(): StepResult {
  return { state: { stage: "name", error: "expired" }, ticket: { clear: true } };
}

/** Potvrzení e-mailem: bez zdravotních údajů, v záznamu o odeslání jen HMAC adresy a doména. */
async function sendConfirmation(input: {
  weddingId: string;
  to: string;
  locale: Locale;
  summary: Omit<DoneSummary, "emailSent">;
  origin: string;
}): Promise<void> {
  const context = await authSessionContext(input.weddingId);
  if (!context) return;
  const email = renderRsvpConfirmation({
    locale: input.locale,
    partners: { a: context.partnerAName, b: context.partnerBName },
    people: input.summary.people,
    editUrl: `${input.origin}${localePath("/", input.locale)}#potvrdit-ucast`,
    unlisted: input.summary.unlisted,
  });
  await sendTemplatedEmail({
    type: "rsvp_confirmation",
    to: input.to,
    weddingId: input.weddingId,
    locale: input.locale,
    email,
    secret: requireEnv("AUTH_SECRET"),
  });
}
