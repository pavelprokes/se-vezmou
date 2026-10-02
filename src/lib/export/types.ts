import { z } from "zod";
import { locales } from "@/i18n/config";
import { i18nTextSchema } from "@/site/i18n-text";

/**
 * Tvar odpovědi databázové funkce `admin_export_guests` (docs/data-model.md kap. 17), ověřený hned za hranicí
 * databáze. Jeden řádek na osobu: host ze seznamu, doprovod, dítě doplněné při RSVP, host mimo seznam.
 */

export const personKinds = ["guest", "plus_one", "child", "unlisted"] as const;
export type PersonKind = (typeof personKinds)[number];

const personSchema = z.object({
  household: z.string().nullable(),
  name: z.string(),
  kind: z.enum(personKinds),
  age: z.number().nullable(),
  invited_event_ids: z.array(z.string()),
  answered: z.boolean(),
  attendance: z.array(z.object({ event_id: z.string(), attending: z.boolean() })),
  submitted_at: z.string().nullable(),
  entered_by: z.enum(["guest", "admin"]).nullable(),
  contact_email: z.string().nullable(),
  answers: z.record(z.string(), z.unknown()),
  diet: z.string().nullable(),
  allergies: z.string().nullable(),
});

export const guestExportSchema = z.object({
  wedding: z.object({
    partner_a_name: z.string(),
    partner_b_name: z.string(),
    starts_on: z.string().nullable(),
    default_locale: z.enum(locales),
  }),
  include_health: z.boolean(),
  events: z.array(
    z.object({ id: z.string(), title: i18nTextSchema.nullable(), starts_at: z.string() }),
  ),
  questions: z.array(
    z.object({
      key: z.string(),
      type: z.enum(["text", "choice", "bool"]),
      label: i18nTextSchema,
      options: z.array(z.unknown()).nullable(),
    }),
  ),
  people: z.array(personSchema),
});

export type GuestExport = z.infer<typeof guestExportSchema>;

/** Tabulka k zápisu do CSV nebo Excelu: záhlaví a řádky textových a číselných buněk. */
export type Cell = string | number | null;
export type Table = { name: string; headers: string[]; rows: Cell[][] };

export type ExportFormat = "csv" | "xlsx";

export type ExportFile = {
  filename: string;
  contentType: string;
  body: Buffer;
};
