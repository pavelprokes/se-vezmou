import { z } from "zod";
import { locales } from "@/i18n/config";
import { i18nTextSchema } from "./i18n-text";
import { isValidBic, isValidIban } from "./payment";
import { templateKeys } from "./themes/palettes";

/**
 * Snímek zveřejněné verze webu (`site_versions.public_content`, `get_public_site`).
 * Neobsahuje citlivé bloky: číslo účtu a další údaje za PINem jsou zvlášť v `SensitiveContent`.
 * Texty ukládá správce po jazycích a nikdy se neukládají upravené typograficky (typo() běží při vykreslení).
 */

export const localeSchema = z.enum(locales);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.iso.datetime({ offset: true });
const anchorSchema = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/);
/** Jen odkazy http(s): do webu nesmí proniknout `javascript:` ani jiná schémata. */
const httpUrl = z.url({ protocol: /^https?$/ });
/** Odkaz na externí galerii (FR-WEB-5): jen https, nic jiného (ani `http:`, `javascript:` či `data:`). */
export const httpsUrl = z
  .url({ protocol: /^https$/ })
  .max(500)
  .refine((value) => !/\s/.test(value), "Odkaz nesmí obsahovat mezery");

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

export const publicMediaSchema = z.object({
  id: z.string(),
  /** Adresa největší varianty (`/media/{id}/{šířka}`) nebo jediného souboru starších snímků a fixtur. */
  src: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Popisek (povinný, pokud obrázek není dekorativní; WCAG 1.1.1). */
  alt: i18nTextSchema.nullable(),
  decorative: z.boolean().default(false),
  /**
   * Šířky dostupných variant (px; každá ve WebP i AVIF, M7c). Se šířkami se vykreslí `<picture>` se `srcset`
   * (AVIF před WebP); bez nich (starší snímek, fixtura) jediný obrázek na `src`.
   */
  widths: z.array(z.number().int().positive()).max(8).default([]),
});
const mediaSchema = publicMediaSchema;

const venueSchema = z
  .object({
    id: z.string(),
    name: i18nTextSchema,
    /**
     * Textová adresa je vždy, mapa je jen doplněk (FR-WEB-1). Soukromé místo (`isPrivate`) nemá adresu
     * ve veřejném snímku: je v `SensitiveContent.venues` a hosté ji vidí až po PINu (FR-PRIV-2).
     */
    address: z.string().min(1).nullable().default(null),
    isPrivate: z.boolean().default(false),
    directions: i18nTextSchema.nullable().default(null),
    /** Vlastní odkaz na mapu od páru (volitelný). */
    mapUrl: httpUrl.nullable().default(null),
    /**
     * Souřadnice z adresy (Nominatim) pro statickou mapu z dlaždic vlastního původu (`showMap` bloku místa).
     * Soukromé místo je ve veřejném snímku nikdy nemá.
     */
    lat: z.number().min(-90).max(90).nullable().default(null),
    lng: z.number().min(-180).max(180).nullable().default(null),
  })
  .refine((venue) => (venue.lat === null) === (venue.lng === null), {
    message: "Souřadnice místa jsou obě, nebo žádná",
    path: ["lat"],
  })
  .refine((venue) => venue.isPrivate || venue.address !== null, {
    message: "Veřejné místo musí mít textovou adresu",
    path: ["address"],
  })
  .refine(
    (venue) =>
      !venue.isPrivate ||
      (venue.address === null &&
        venue.mapUrl === null &&
        venue.directions === null &&
        venue.lat === null),
    {
      message:
        "Soukromé místo nesmí mít adresu, mapu, souřadnice ani popis cesty ve veřejném snímku",
      path: ["address"],
    },
  );

const eventSchema = z.object({
  id: z.string(),
  kind: z.enum(["ceremony", "reception", "other"]),
  title: i18nTextSchema,
  description: i18nTextSchema.nullable().default(null),
  startsAt: isoDateTime,
  endsAt: isoDateTime.nullable().default(null),
  venueId: z.string().nullable().default(null),
  /**
   * Událost je cílem pozvání a větvení potvrzení účasti (správa hostů, M7b). Starší snímky pole
   * nemají; chybějící hodnota znamená obřad a hostina ano, ostatní události ne.
   */
  rsvpEnabled: z.boolean().optional(),
});

const blockBase = {
  id: z.string(),
  anchor: anchorSchema,
  enabled: z.boolean(),
  position: z.number().int(),
  /** Blok je za PINem hostů (FR-PRIV-2); jeho obsah není ve veřejném snímku. */
  sensitive: z.boolean().default(false),
};

export const heroData = z.object({
  countdown: z.boolean().default(false),
  tagline: i18nTextSchema.nullable().default(null),
  /** Volitelná fotka přes celý úvod (šablony, které ji umí, např. Eukalyptus); médium je v `content.media`. */
  photoMediaId: z.string().nullable().default(null),
});
export const programData = z.object({ intro: i18nTextSchema.nullable().default(null) });
export const venueData = z.object({
  venueIds: z.array(z.string()),
  intro: i18nTextSchema.nullable().default(null),
  /** Statická mapa veřejných míst se souřadnicemi přes celou šířku (volba v průvodci). */
  showMap: z.boolean().default(false),
});
export const lodgingData = z.object({
  items: z.array(
    z
      .object({
        id: z.string(),
        name: i18nTextSchema,
        description: i18nTextSchema.nullable().default(null),
        url: httpUrl.nullable().default(null),
        /** Adresa ubytování (nepovinná); starší snímky ji nemají. */
        address: z.string().min(1).max(250).nullable().default(null),
        /** Ubytování se ukáže i na mapě místa konání (jen s nalezenými souřadnicemi). */
        showOnMap: z.boolean().default(false),
        lat: z.number().min(-90).max(90).nullable().default(null),
        lng: z.number().min(-180).max(180).nullable().default(null),
      })
      .refine((item) => (item.lat === null) === (item.lng === null), {
        message: "Souřadnice ubytování jsou obě, nebo žádná",
        path: ["lat"],
      }),
  ),
  transport: i18nTextSchema.nullable().default(null),
});
export const dresscodeData = z.object({ text: i18nTextSchema });
export const faqData = z.object({
  items: z.array(z.object({ id: z.string(), question: i18nTextSchema, answer: i18nTextSchema })),
});
export const contactData = z.object({
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
export const storyData = z.object({
  text: i18nTextSchema,
  mediaId: z.string().nullable().default(null),
});
/** `payment`: pár zadal číslo účtu (je za PINem); bez něj je sekce jen úvodní text bez PINu. Starší snímky: true. */
export const giftsData = z.object({
  intro: i18nTextSchema.nullable().default(null),
  payment: z.boolean().default(true),
});
/**
 * Karta odkazu na externí galerii: údaje z Open Graph cílové stránky, které načetl SERVER při uložení
 * nebo změně odkazu (ne při zobrazení hostovi). Titulek a popis jsou nedůvěryhodný text (vždy se
 * vypisují jako text). `imageUrl` se na webu NEVYKRESLUJE (žádný hotlink, host nevolá cizí web);
 * vykresluje se až jeho kopie ve vlastním úložišti (`imageMediaId`, M7c).
 */
export const galleryCardSchema = z.object({
  title: z.string().max(200).nullable().default(null),
  description: z.string().max(400).nullable().default(null),
  imageUrl: httpsUrl.nullable().default(null),
  fetchedAt: isoDateTime.nullable().default(null),
  /**
   * Náhledový obrázek cílové stránky ZKOPÍROVANÝ do vlastního úložiště (M7c): server ho stáhl při načtení karty,
   * překódoval a uložil jako dekorativní médium. Web vykresluje jen tento obrázek ze své adresy `/media/…`,
   * nikdy `imageUrl` (host nevolá cizí web). `null`, když úložiště není nastavené nebo se obrázek nepodařilo uložit.
   */
  imageMediaId: z.guid().nullable().default(null),
  /** `ok`: něco se načetlo; `failed`: pokus selhal (karta spadne na doménu a text odkazu). */
  status: z.enum(["ok", "failed"]).default("ok"),
});
export type GalleryCard = z.infer<typeof galleryCardSchema>;

/**
 * Odkaz na externí fotogalerii (např. u fotografa). Vlastní fotografie páru jsou v `galleryData.mediaIds` (M7c), odkaz
 * je jediná cesta k velké galerii. Veřejný odkaz je přímo ve snímku; chráněný odkaz (`protected`)
 * v něm není (`url = null`, ani `card`): je v `SensitiveContent.gallery` a vykreslí se až po PINu hostů.
 */
export const galleryLinkSchema = z
  .object({
    url: httpsUrl.nullable().default(null),
    /** Text odkazu (název galerie) po jazycích; přepisuje název z cílové stránky. */
    label: i18nTextSchema.nullable().default(null),
    protected: z.boolean().default(false),
    card: galleryCardSchema.nullable().default(null),
  })
  .refine(
    (link) => (link.protected ? link.url === null && link.card === null : link.url !== null),
    {
      message: "Veřejný odkaz má adresu, chráněný ji ani kartu ve veřejném snímku mít nesmí",
      path: ["url"],
    },
  );
export type GalleryLink = z.infer<typeof galleryLinkSchema>;

export const galleryData = z.object({
  /** Fotografie galerie v pořadí. U fotografií chráněných PINem je pole prázdné (jsou v `SensitiveContent.photos`). */
  mediaIds: z.array(z.string()),
  /** Fotografie jsou jen pro hosty s PINem (FR-PRIV-2): ve veřejném snímku ani v doručení nejsou. */
  photosProtected: z.boolean().default(false),
  link: galleryLinkSchema.nullable().default(null),
});
export const rsvpData = z.object({ intro: i18nTextSchema.nullable().default(null) });

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
  /** Adresy soukromých míst podle `venue.id` (místa s `isPrivate`); mapa a popis cesty jsou volitelné. */
  venues: z
    .record(
      z.string(),
      z.object({
        address: z.string().min(1),
        mapUrl: httpUrl.nullable().default(null),
        directions: i18nTextSchema.nullable().default(null),
      }),
    )
    .default({}),
  /** Adresa chráněného odkazu na externí galerii (`GalleryLink.protected`). */
  gallery: z
    .object({ url: httpsUrl, card: galleryCardSchema.nullable().default(null) })
    .nullable()
    .default(null),
  /**
   * Fotografie chráněné PINem hostů (`GalleryData.photosProtected`) a obrázek karty chráněného odkazu v pořadí
   * galerie; vykreslí se jen s příznakem `sensitiveUnlocked` a doručí je jen host s relací po PINu.
   */
  photos: z.array(publicMediaSchema).default([]),
  gifts: z
    .object({
      /** Číslo účtu v tuzemském tvaru pro zobrazení, např. `19-2000145399/0800`. */
      account: z.string().min(1),
      iban: z.string().refine(isValidIban, "Neplatný IBAN"),
      holder: z.string().nullable().default(null),
      /** BIC/SWIFT pro zahraniční hosty (anglická verze ho ukazuje jako text vedle IBANu). */
      bic: z.string().refine(isValidBic, "Neplatný BIC").nullable().default(null),
      /** Zpráva pro příjemce v QR platbě (bez pevné částky). */
      paymentMessage: z.string().max(60).nullable().default(null),
    })
    .nullable()
    .default(null),
});

export type SensitiveContent = z.infer<typeof sensitiveContentSchema>;
