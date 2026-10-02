import type { Locale } from "@/i18n/config";
import { pick } from "@/site/i18n-text";
import type { Cell, GuestExport, PersonKind, Table } from "./types";

/**
 * Převod odpovědi `admin_export_guests` na tabulku „Hosté a RSVP“ (jeden řádek na osobu, sloupec na každou
 * událost a otázku). Popisky podle jazyka správce; texty hostů se nepřekládají ani neupravují (export je
 * věrný zdroji, typografie se na údaje hostů nikdy neaplikuje, docs/data-model.md kap. 9).
 * Zdravotní údaje (dieta, alergie) jsou ve sloupcích jen tehdy, když o ně správce výslovně požádal.
 */

type Labels = {
  sheet: string;
  household: string;
  name: string;
  kindHeader: string;
  kind: Record<PersonKind, string>;
  age: string;
  answered: string;
  yes: string;
  no: string;
  attending: string;
  declined: string;
  noReply: string;
  notInvited: string;
  lodging: string;
  transport: string;
  song: string;
  lodgingValues: Record<string, string>;
  transportValues: Record<string, string>;
  contact: string;
  submittedAt: string;
  enteredBy: string;
  enteredByValues: Record<string, string>;
  diet: string;
  allergies: string;
  unlistedHousehold: string;
};

const LABELS: Record<Locale, Labels> = {
  cs: {
    sheet: "Hosté a RSVP",
    household: "Domácnost",
    name: "Jméno",
    kindHeader: "Typ",
    kind: { guest: "Host", plus_one: "Doprovod", child: "Dítě", unlisted: "Host mimo seznam" },
    age: "Věk",
    answered: "Odpověděl(a)",
    yes: "ano",
    no: "ne",
    attending: "přijde",
    declined: "nepřijde",
    noReply: "neodpověděl(a)",
    notInvited: "nepozván(a)",
    lodging: "Ubytování",
    transport: "Doprava",
    song: "Píseň",
    lodgingValues: { need: "potřebuje", own: "vlastní", unsure: "nejistě" },
    transportValues: { need: "potřebuje", own: "vlastní", offer: "nabízí místa" },
    contact: "Kontaktní e-mail",
    submittedAt: "Odpověď odeslána",
    enteredBy: "Zadal(a)",
    enteredByValues: { guest: "host", admin: "správce" },
    diet: "Dieta",
    allergies: "Alergie",
    unlistedHousehold: "(mimo seznam)",
  },
  en: {
    sheet: "Guests and RSVP",
    household: "Household",
    name: "Name",
    kindHeader: "Type",
    kind: { guest: "Guest", plus_one: "Plus one", child: "Child", unlisted: "Unlisted guest" },
    age: "Age",
    answered: "Replied",
    yes: "yes",
    no: "no",
    attending: "attending",
    declined: "not attending",
    noReply: "no reply",
    notInvited: "not invited",
    lodging: "Accommodation",
    transport: "Transport",
    song: "Song",
    lodgingValues: { need: "needed", own: "own", unsure: "not sure" },
    transportValues: { need: "needed", own: "own", offer: "offers seats" },
    contact: "Contact e-mail",
    submittedAt: "Reply submitted",
    enteredBy: "Entered by",
    enteredByValues: { guest: "guest", admin: "administrator" },
    diet: "Diet",
    allergies: "Allergies",
    unlistedHousehold: "(unlisted)",
  },
};

function isoMinute(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 16).replace("T", " ");
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function buildGuestTable(data: GuestExport, locale: Locale): Table {
  const l = LABELS[locale];
  const fallback = data.wedding.default_locale;
  const builtinKeys = new Set(["lodging", "transport", "song"]);
  const usesAnswer = (key: string) => data.people.some((p) => text(p.answers[key]) !== null);

  const customQuestions = data.questions.filter((q) => !builtinKeys.has(q.key));
  const builtinColumns = (
    [
      ["lodging", l.lodging],
      ["transport", l.transport],
      ["song", l.song],
    ] as const
  ).filter(([key]) => usesAnswer(key));

  const headers = [
    l.household,
    l.name,
    l.kindHeader,
    l.age,
    l.answered,
    ...data.events.map((event) => pick(event.title, locale, fallback) || "?"),
    ...builtinColumns.map(([, label]) => label),
    ...customQuestions.map((q) => pick(q.label, locale, fallback) || q.key),
    l.contact,
    l.submittedAt,
    l.enteredBy,
    ...(data.include_health ? [l.diet, l.allergies] : []),
  ];

  const rows: Cell[][] = data.people.map((person) => {
    const attendance = new Map(person.attendance.map((a) => [a.event_id, a.attending]));
    const invited = new Set(person.invited_event_ids);
    const eventCell = (eventId: string): string => {
      const attending = attendance.get(eventId);
      if (attending !== undefined) return attending ? l.attending : l.declined;
      if (invited.has(eventId)) return l.noReply;
      // doprovod a hosté mimo seznam nemají pozvání: bez odpovědi není co uvést
      return person.kind === "guest" || person.kind === "child" ? l.notInvited : "";
    };
    const answer = (key: string): string | null => {
      const raw = person.answers[key];
      if (key === "lodging") return text(l.lodgingValues[String(raw)] ?? raw);
      if (key === "transport") return text(l.transportValues[String(raw)] ?? raw);
      return text(raw);
    };
    const custom = (question: GuestExport["questions"][number]): string | null => {
      const raw = person.answers[question.key];
      if (typeof raw === "boolean") return raw ? l.yes : l.no;
      if (question.type === "choice" && typeof raw === "string") {
        for (const option of question.options ?? []) {
          const candidate = option as { value?: unknown; label?: unknown };
          if (candidate.value === raw) {
            const label = pick(candidate.label as never, locale, fallback);
            return label || raw;
          }
        }
      }
      return text(raw);
    };
    return [
      person.household ?? (person.kind === "unlisted" ? l.unlistedHousehold : null),
      person.name,
      l.kind[person.kind],
      person.age,
      person.answered ? l.yes : l.no,
      ...data.events.map((event) => eventCell(event.id)),
      ...builtinColumns.map(([key]) => answer(key)),
      ...customQuestions.map(custom),
      person.contact_email,
      isoMinute(person.submitted_at),
      person.entered_by ? (l.enteredByValues[person.entered_by] ?? person.entered_by) : null,
      ...(data.include_health ? [person.diet, person.allergies] : []),
    ];
  });

  return { name: l.sheet, headers, rows };
}
