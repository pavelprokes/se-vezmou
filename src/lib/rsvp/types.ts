import { z } from "zod";
import { locales } from "@/i18n/config";
import { phases } from "@/site/types";
import { i18nTextSchema } from "@/site/i18n-text";

/**
 * Tvary dat RSVP. Dvě skupiny:
 *  1. odpovědi databázových funkcí (`rsvp_get`, `rsvp_unlisted_form`, `rsvp_info`, `admin_*`),
 *     ověřené zod schématy hned za hranicí databáze,
 *  2. model formuláře a stav, který server posílá do prohlížeče (jen hotové texty a ID, nikdy
 *     seznam hostů ani údaje jiné domácnosti).
 */

// --- 1. databáze ------------------------------------------------------------------------

export const eventKinds = ["ceremony", "reception", "other"] as const;

const dbEventSchema = z.object({
  id: z.string(),
  kind: z.enum(eventKinds),
  title: i18nTextSchema,
  description: i18nTextSchema.nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
});

const dbQuestionSchema = z.object({
  id: z.string(),
  key: z.string(),
  type: z.enum(["text", "choice", "bool"]),
  label: i18nTextSchema,
  // Možnosti jsou jsonb bez kontroly tvaru, model formuláře si vybere jen platné.
  options: z.array(z.unknown()).nullable(),
  required: z.boolean(),
  event_id: z.string().nullable(),
});

const dbSettingsSchema = z.object({
  enabled_questions: z.record(z.string(), z.unknown()),
  email_confirmation: z.boolean(),
  opens_at: z.string().nullable().optional(),
  closes_at: z.string().nullable().optional(),
});

/** Časové pásmo a výchozí jazyk svatby: čas událostí a náhradní jazyk textů se počítají podle nich. */
const dbWeddingSchema = z.object({ timezone: z.string(), default_locale: z.enum(locales) });

const dbPersonSchema = z.object({
  guest_id: z.string().nullable(),
  person_name: z.string(),
  is_plus_one: z.boolean(),
  is_child: z.boolean(),
  age: z.number().nullable(),
  attendance: z.array(z.object({ event_id: z.string(), attending: z.boolean() })),
  diet: z.string().nullable(),
  allergies: z.string().nullable(),
  /** Host (`rsvp_get`): dřívější odpověď má dietu nebo alergie, hodnoty se mu ale neposílají. */
  has_health: z.boolean().optional(),
});

/** `rsvp_get` a `admin_rsvp_household`: domácnost, její pozvání a dřívější odpověď. */
export const rsvpViewSchema = z.object({
  household_id: z.string(),
  wedding: dbWeddingSchema,
  guests: z.array(
    z.object({
      id: z.string(),
      display_name: z.string(),
      is_child: z.boolean(),
      age: z.number().nullable(),
    }),
  ),
  events: z.array(dbEventSchema),
  invitations: z.array(z.object({ guest_id: z.string(), event_id: z.string() })),
  settings: dbSettingsSchema.nullable(),
  questions: z.array(dbQuestionSchema),
  response: z
    .object({
      answers: z.record(z.string(), z.unknown()),
      contact_email: z.string().nullable(),
      /** Host (`rsvp_get`): e-mail je uložený, adresa se mu ale neposílá. */
      has_email: z.boolean().optional(),
      entered_by: z.enum(["guest", "admin"]),
      people: z.array(dbPersonSchema),
    })
    .nullable(),
});
export type RsvpView = z.infer<typeof rsvpViewSchema>;

/** `rsvp_unlisted_form`: události a otázky pro hosta mimo seznam. */
export const unlistedFormSchema = z.object({
  wedding: dbWeddingSchema,
  events: z.array(dbEventSchema),
  settings: dbSettingsSchema,
  questions: z.array(dbQuestionSchema),
});
export type UnlistedFormView = z.infer<typeof unlistedFormSchema>;

/** `rsvp_info`: otevřenost RSVP a volby páru, které host potřebuje před ověřením jména. */
export const rsvpInfoSchema = z.object({
  phase: z.enum(phases),
  open: z.boolean(),
  allow_unlisted: z.boolean(),
  email_confirmation: z.boolean(),
  closes_at: z.string().nullable(),
});
export type RsvpInfo = z.infer<typeof rsvpInfoSchema>;

// --- odesílaná data ---------------------------------------------------------------------

export interface PayloadPerson {
  guest_id: string | null;
  person_name?: string;
  is_child?: boolean;
  age?: number | null;
  diet?: string | null;
  allergies?: string | null;
  /** Ponechat dřívější dietu a alergie, které host neviděl (bez nových hodnot). */
  keep_health?: boolean;
  /** Původní jméno doprovodu nebo dítěte, podle kterého se uložené údaje najdou i po přejmenování. */
  health_name?: string;
  attendance: { event_id: string; attending: boolean }[];
}

/** Obsah pro `rsvp_submit`, `rsvp_submit_unlisted` a `admin_rsvp_enter`. */
export interface SubmitPayload {
  contact_email?: string | null;
  /** Ponechat dřívější e-mail pro potvrzení, který host neviděl (bez nového e-mailu). */
  keep_email?: boolean;
  answers: Record<string, string | boolean>;
  people: PayloadPerson[];
  /** Idempotenční klíč odpovědi hosta mimo seznam (UUID z prohlížeče); databáze ho vynucuje jako unikátní. */
  nonce?: string;
}

// --- 2. správcovská strana --------------------------------------------------------------

export const householdStatuses = ["no_response", "attending", "declined"] as const;
export type HouseholdStatus = (typeof householdStatuses)[number];

const guestAttendanceSchema = z.array(z.object({ event_id: z.string(), attending: z.boolean() }));

/** `admin_guest_list` */
export const guestListSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(eventKinds),
      title: i18nTextSchema,
      starts_at: z.string(),
      rsvp_enabled: z.boolean(),
    }),
  ),
  households: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      invited_note: z.string().nullable(),
      /** Skupiny (štítky) domácnosti, jen pro správce. */
      tags: z.array(z.string()).default([]),
      guests: z.array(
        z.object({
          id: z.string(),
          display_name: z.string(),
          is_child: z.boolean(),
          age: z.number().nullable(),
          is_plus_one: z.boolean(),
          source: z.enum(["import", "manual", "rsvp"]),
          invited_event_ids: z.array(z.string()),
          attendance: guestAttendanceSchema,
        }),
      ),
      response: z
        .object({
          id: z.string(),
          submitted_at: z.string(),
          last_edited_at: z.string(),
          entered_by: z.enum(["guest", "admin"]),
          has_email: z.boolean(),
          attending: z.boolean(),
        })
        .nullable(),
    }),
  ),
  unlisted: z.array(
    z.object({
      id: z.string(),
      submitted_at: z.string(),
      people: z.array(
        z.object({
          person_name: z.string(),
          is_child: z.boolean(),
          age: z.number().nullable(),
          attendance: guestAttendanceSchema,
        }),
      ),
    }),
  ),
});
export type GuestList = z.infer<typeof guestListSchema>;

/** `admin_rsvp_overview` (počty jsou celá čísla, PostgreSQL `count` se v JSON vrací jako číslo). */
export const rsvpOverviewSchema = z.object({
  households: z.object({ total: z.number(), answered: z.number(), pending: z.number() }),
  guests: z.object({ total: z.number(), children: z.number() }),
  extra_people: z.object({
    plus_ones: z.number(),
    unlisted: z.number(),
    added_children: z.number(),
  }),
  events: z.array(
    z.object({
      event_id: z.string(),
      kind: z.enum(eventKinds),
      title: i18nTextSchema,
      starts_at: z.string(),
      invited: z.number(),
      attending: z.number(),
      declined: z.number(),
      attending_extra: z.number(),
      pending: z.number(),
    }),
  ),
});
export type RsvpOverview = z.infer<typeof rsvpOverviewSchema>;

/** Stav domácnosti pro přehled: neodpověděla / někdo přijde / nikdo nepřijde. */
export function householdStatus(household: GuestList["households"][number]): HouseholdStatus {
  if (!household.response) return "no_response";
  return household.response.attending ? "attending" : "declined";
}
