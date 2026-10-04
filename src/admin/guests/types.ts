import { z } from "zod";
import { locales } from "@/i18n/config";
import { i18nTextSchema } from "@/site/i18n-text";

/**
 * Tvary dat správy hostů a nastavení RSVP (M7b). Vstupy z prohlížeče procházejí `*InputSchema`
 * (každá Server Action vstup znovu ověřuje, prohlížeči se nevěří); odpovědi databázových funkcí
 * `*ViewSchema` hned za hranicí databáze. Limity odpovídají kontrolám v SQL
 * (`supabase/migrations/20261007100000_admin_guests.sql`).
 */

export const GUEST_LIMITS = {
  label: 200,
  note: 500,
  /** Skupiny (štítky) domácnosti, stejné meze jako `tags_from_payload` v SQL. */
  tag: 40,
  tagsPerHousehold: 10,
  name: 200,
  guestsPerHousehold: 20,
  maxChildAge: 17,
  /** Strop hostů na svatbu (stejný jako v databázi). */
  guestsPerWedding: 1500,
} as const;

const eventIds = z.array(z.uuid()).max(50);

export const guestInputSchema = z.object({
  id: z.uuid().nullable(),
  displayName: z.string().trim().min(1).max(GUEST_LIMITS.name),
  isChild: z.boolean(),
  age: z.number().int().min(0).max(GUEST_LIMITS.maxChildAge).nullable(),
  invitedEventIds: eventIds,
});

/** Název skupiny (štítku) domácnosti. */
export const tagSchema = z.string().trim().min(1).max(GUEST_LIMITS.tag);

export const householdInputSchema = z.object({
  label: z.string().trim().max(GUEST_LIMITS.label),
  tags: z.array(tagSchema).max(GUEST_LIMITS.tagsPerHousehold).default([]),
  note: z.string().trim().max(GUEST_LIMITS.note).nullable(),
  guests: z.array(guestInputSchema).min(1).max(GUEST_LIMITS.guestsPerHousehold),
});
export type HouseholdInput = z.infer<typeof householdInputSchema>;
export type GuestInput = z.infer<typeof guestInputSchema>;

/** Podoba zápisu pro databázovou funkci (`admin_household_save`). */
export function householdToPayload(input: HouseholdInput) {
  return {
    label: input.label,
    tags: input.tags,
    note: input.note && input.note.length > 0 ? input.note : null,
    guests: input.guests.map((guest) => ({
      id: guest.id,
      display_name: guest.displayName,
      is_child: guest.isChild,
      age: guest.isChild ? guest.age : null,
      invited_event_ids: guest.invitedEventIds,
    })),
  };
}

// --- nastavení RSVP -------------------------------------------------------------------------

export const BUILTIN_QUESTIONS = [
  "plus_one",
  "children",
  "diet",
  "lodging",
  "transport",
  "song",
] as const;
export type BuiltinQuestion = (typeof BUILTIN_QUESTIONS)[number];

export const QUESTION_LIMITS = { custom: 10, options: 10, label: 200, optionLabel: 100 } as const;

const optionSchema = z.object({
  value: z.string().regex(/^[a-z0-9_]{1,40}$/),
  label: i18nTextSchema,
});

export const questionInputSchema = z.object({
  id: z.uuid().nullable(),
  /** Klíč se zakládá při vytvoření otázky a pak se nemění (odpovědi hostů se k němu vážou). */
  key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  type: z.enum(["text", "choice", "bool"]),
  label: i18nTextSchema,
  options: z.array(optionSchema).max(QUESTION_LIMITS.options).nullable(),
  required: z.boolean(),
  eventId: z.uuid().nullable(),
  enabled: z.boolean(),
});
export type QuestionInput = z.infer<typeof questionInputSchema>;

const isoOrNull = z.iso.datetime({ offset: true }).nullable();

export const rsvpSettingsInputSchema = z.object({
  opensAt: isoOrNull,
  closesAt: isoOrNull,
  allowUnlisted: z.boolean(),
  emailConfirmation: z.boolean(),
  notifyCouple: z.boolean(),
  enabledQuestions: z.partialRecord(z.enum(BUILTIN_QUESTIONS), z.boolean()),
  questions: z.array(questionInputSchema).max(QUESTION_LIMITS.custom),
});
export type RsvpSettingsInput = z.infer<typeof rsvpSettingsInputSchema>;

export function settingsToPayload(input: RsvpSettingsInput) {
  return {
    opens_at: input.opensAt,
    closes_at: input.closesAt,
    allow_unlisted: input.allowUnlisted,
    email_confirmation: input.emailConfirmation,
    enabled_questions: input.enabledQuestions,
    questions: input.questions.map((question) => ({
      id: question.id,
      key: question.key,
      type: question.type,
      label: question.label,
      options: question.type === "choice" ? question.options : null,
      required: question.required,
      event_id: question.eventId,
      enabled: question.enabled,
    })),
  };
}

/** Odpověď `admin_rsvp_settings_get`. */
export const rsvpSettingsViewSchema = z.object({
  timezone: z.string(),
  locales: z.array(z.enum(locales)).min(1),
  default_locale: z.enum(locales),
  settings: z.object({
    opens_at: z.string().nullable(),
    closes_at: z.string().nullable(),
    allow_unlisted: z.boolean(),
    email_confirmation: z.boolean(),
    /** Upozornění páru na odpovědi (vlastní funkce `admin_rsvp_notify_get`, ne součást uložení otázek). */
    notify_couple: z.boolean().default(false),
    enabled_questions: z.record(z.string(), z.unknown()),
  }),
  questions: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      type: z.enum(["text", "choice", "bool"]),
      label: i18nTextSchema,
      options: z.array(z.unknown()).nullable(),
      required: z.boolean(),
      event_id: z.string().nullable(),
      enabled: z.boolean(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["ceremony", "reception", "other"]),
      title: i18nTextSchema,
      starts_at: z.string(),
      rsvp_enabled: z.boolean(),
    }),
  ),
});
export type RsvpSettingsView = z.infer<typeof rsvpSettingsViewSchema>;

/** Stav RSVP z nastavení: otevřené, naplánované, nebo uzavřené (v zadaném okamžiku). */
export type RsvpWindow = "open" | "scheduled" | "closed";

export function rsvpWindow(
  opensAt: string | null,
  closesAt: string | null,
  now: Date = new Date(),
): RsvpWindow {
  const t = now.getTime();
  if (opensAt && Date.parse(opensAt) > t) return "scheduled";
  if (closesAt && Date.parse(closesAt) <= t) return "closed";
  return "open";
}
