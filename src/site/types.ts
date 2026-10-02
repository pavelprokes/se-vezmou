import { z } from "zod";
import { locales } from "@/i18n/config";
import { i18nTextSchema } from "./i18n-text";
import { isValidIban } from "./payment";
import { templateKeys } from "./themes/palettes";

/**
 * Snímek zveřejněné verze webu (`site_versions.public_content`, `get_public_site`).
 * Neobsahuje citlivé bloky: číslo účtu a další údaje za PINem jsou zvlášť v `SensitiveContent`.
 * Texty ukládá správce po jazycích a nikdy se neukládají upravené typograficky (typo() běží při vykreslení).
 */

const localeSchema = z.enum(locales);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.iso.datetime({ offset: true });
const anchorSchema = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/);
/** Jen odkazy http(s): do webu nesmí proniknout `javascript:` ani jiná schémata. */
const httpUrl = z.url({ protocol: /^https?$/ });

export const blockTypes = [
  "hero",
  "program",
  "venue",
  "lodging",
  "dresscode",
  "faq",
  "contact",
  "story",
  "gifts",
  "gallery",
  "rsvp",
] as const;
export type BlockType = (typeof blockTypes)[number];

const mediaSchema = z.object({
  id: z.string(),
  src: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Popisek (povinný, pokud obrázek není dekorativní; WCAG 1.1.1). */
  alt: i18nTextSchema.nullable(),
  decorative: z.boolean().default(false),
});

const venueSchema = z.object({
  id: z.string(),
  name: i18nTextSchema,
  /** Textová adresa je vždy, mapa je jen doplněk (FR-WEB-1). */
  address: z.string().min(1),
  directions: i18nTextSchema.nullable().default(null),
  /** Jen odkaz na mapu; web nevkládá žádnou mapu ani skripty třetích stran. */
  mapUrl: httpUrl.nullable().default(null),
});

const eventSchema = z.object({
  id: z.string(),
  kind: z.enum(["ceremony", "reception", "other"]),
  title: i18nTextSchema,
  description: i18nTextSchema.nullable().default(null),
  startsAt: isoDateTime,
  endsAt: isoDateTime.nullable().default(null),
  venueId: z.string().nullable().default(null),
});

const blockBase = {
  id: z.string(),
  anchor: anchorSchema,
  enabled: z.boolean(),
  position: z.number().int(),
  /** Blok je za PINem hostů (FR-PRIV-2); jeho obsah není ve veřejném snímku. */
  sensitive: z.boolean().default(false),
};

const heroData = z.object({
  countdown: z.boolean().default(false),
  tagline: i18nTextSchema.nullable().default(null),
});
const programData = z.object({ intro: i18nTextSchema.nullable().default(null) });
const venueData = z.object({
  venueIds: z.array(z.string()),
  intro: i18nTextSchema.nullable().default(null),
});
const lodgingData = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: i18nTextSchema,
      description: i18nTextSchema.nullable().default(null),
      url: httpUrl.nullable().default(null),
    }),
  ),
  transport: i18nTextSchema.nullable().default(null),
});
const dresscodeData = z.object({ text: i18nTextSchema });
const faqData = z.object({
  items: z.array(z.object({ id: z.string(), question: i18nTextSchema, answer: i18nTextSchema })),
});
const contactData = z.object({
  people: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: i18nTextSchema.nullable().default(null),
      email: z.email().nullable().default(null),
      phone: z
        .string()
        .regex(/^\+?[0-9 ]{6,20}$/)
        .nullable()
        .default(null),
    }),
  ),
});
const storyData = z.object({ text: i18nTextSchema, mediaId: z.string().nullable().default(null) });
const giftsData = z.object({ intro: i18nTextSchema.nullable().default(null) });
const galleryData = z.object({ mediaIds: z.array(z.string()) });
const rsvpData = z.object({ intro: i18nTextSchema.nullable().default(null) });

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ ...blockBase, type: z.literal("hero"), data: heroData }),
  z.object({ ...blockBase, type: z.literal("program"), data: programData }),
  z.object({ ...blockBase, type: z.literal("venue"), data: venueData }),
  z.object({ ...blockBase, type: z.literal("lodging"), data: lodgingData }),
  z.object({ ...blockBase, type: z.literal("dresscode"), data: dresscodeData }),
  z.object({ ...blockBase, type: z.literal("faq"), data: faqData }),
  z.object({ ...blockBase, type: z.literal("contact"), data: contactData }),
  z.object({ ...blockBase, type: z.literal("story"), data: storyData }),
  z.object({ ...blockBase, type: z.literal("gifts"), data: giftsData }),
  z.object({ ...blockBase, type: z.literal("gallery"), data: galleryData }),
  z.object({ ...blockBase, type: z.literal("rsvp"), data: rsvpData }),
]);

export type Block = z.infer<typeof blockSchema>;
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;

/** Fáze svatby (data-model.md, kapitola 7); `thanks` je režim poděkování po svatbě (FR-WEB-4). */
export const phases = [
  "save_the_date",
  "rsvp_open",
  "rsvp_closed",
  "wedding_day",
  "thanks",
] as const;
export type Phase = (typeof phases)[number];

export const publicContentSchema = z
  .object({
    version: z.literal(1),
    slug: z.string(),
    partners: z.object({ a: z.string().min(1), b: z.string().min(1) }),
    startsOn: isoDate,
    endsOn: isoDate.nullable().default(null),
    timezone: z.string().default("Europe/Prague"),
    locales: z.array(localeSchema).min(1),
    defaultLocale: localeSchema,
    template: z.enum(templateKeys),
    palette: z.string(),
    phase: z.enum(phases),
    /** Zapnutá „rychlá změna“; `null`, když je vypnutá (FR-ADM-3). */
    quickNotice: i18nTextSchema.nullable().default(null),
    /** Poděkování v režimu po svatbě (nepovinné). */
    thanksMessage: i18nTextSchema.nullable().default(null),
    venues: z.array(venueSchema),
    events: z.array(eventSchema),
    media: z.array(mediaSchema),
    blocks: z.array(blockSchema),
  })
  .refine((c) => c.locales.includes(c.defaultLocale), {
    message: "Výchozí jazyk musí být mezi jazyky webu",
    path: ["defaultLocale"],
  });

export type PublicContent = z.infer<typeof publicContentSchema>;
export type PublicEvent = PublicContent["events"][number];
export type PublicVenue = PublicContent["venues"][number];
export type PublicMedia = PublicContent["media"][number];

/**
 * Údaje za PINem hostů (`site_version_sensitive.sensitive_content`). Vykreslí se jen s příznakem
 * `sensitiveUnlocked`; do veřejného snímku se nikdy nepřidávají.
 */
export const sensitiveContentSchema = z.object({
  gifts: z
    .object({
      /** Číslo účtu v tuzemském tvaru pro zobrazení, např. `19-2000145399/0800`. */
      account: z.string().min(1),
      iban: z.string().refine(isValidIban, "Neplatný IBAN"),
      holder: z.string().nullable().default(null),
      /** Zpráva pro příjemce v QR platbě (bez pevné částky). */
      paymentMessage: z.string().max(60).nullable().default(null),
    })
    .nullable()
    .default(null),
});

export type SensitiveContent = z.infer<typeof sensitiveContentSchema>;
