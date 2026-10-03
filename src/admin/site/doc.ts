import { z } from "zod";
import { locales, type Locale } from "@/i18n/config";
import { missingLocales, type I18nText } from "@/site/i18n-text";
import { czAccountToIban, isValidCzAccount, isValidIban } from "@/site/payment";
import { phaseFromDates } from "@/site/phase";
import { hasPalette, isTemplateKey, templateKeys } from "@/site/themes/palettes";
import { validateTemplatePalette } from "@/site/themes/validate";
import {
  blockTypes,
  galleryCardSchema,
  httpsUrl,
  publicContentSchema,
  sensitiveContentSchema,
  type BlockType,
  type Phase,
  type PublicContent,
  type PublicMedia,
  type SensitiveContent,
} from "@/site/types";
import { mediaSrc, isReady, type MediaItem } from "@/lib/media/types";
import { normalizeHttpsUrl, normalizePhone, normalizeUrl } from "./normalize";

/**
 * Pracovní kopie webu páru pro správu (M7a): jeden dokument, který edituje prohlížeč, ukládá server
 * (`admin_site_save`) a ze kterého vzniká živý náhled i zveřejněný snímek. Texty páru nejsou
 * typograficky upravené (typo() běží až při vykreslení webu).
 *
 * Dokument se liší od zveřejněného snímku (`PublicContent`) třemi věcmi, které do veřejného
 * snímku nesmějí: číslo účtu u darů, adresa soukromého místa a chráněný odkaz na galerii jsou
 * v dokumentu u svého bloku nebo místa (jen správce je vidí) a při sestavení snímku (`docToPublic`)
 * se přesunou do `SensitiveContent`. Opačný převod (`publicToDoc`) slouží k vrácení verze.
 */

// --- limity (výchozí návrh, obrana proti obřím datům) ------------------------------------------

export const LIMITS = {
  text: 2000,
  short: 200,
  name: 100,
  events: 60,
  venues: 20,
  faq: 40,
  lodging: 20,
  contacts: 12,
} as const;

const localeSchema = z.enum(locales);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.iso.datetime({ offset: true });

/** Text po jazycích s horní mezí délky. */
const text = (max: number = LIMITS.text) =>
  z.object({ cs: z.string().max(max).optional(), en: z.string().max(max).optional() }).strict();
const optionalText = (max?: number) => text(max).nullable().default(null);

// --- bloky ---------------------------------------------------------------------------------

const blockBase = {
  id: uuid,
  anchor: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
  enabled: z.boolean(),
  position: z.number().int().min(0).max(1000),
  sensitive: z.boolean().default(false),
};

export const giftsDataSchema = z.object({
  intro: optionalText(),
  /** Číslo účtu v tuzemském tvaru (`19-2000145399/0800`), nebo IBAN u zahraničního účtu. */
  account: z.string().max(60).default(""),
  holder: z.string().max(LIMITS.name).nullable().default(null),
  paymentMessage: z.string().max(60).nullable().default(null),
});

export const galleryLinkEditSchema = z.object({
  /** Adresa v prostém tvaru, i u chráněného odkazu (v databázi je jen v pracovní kopii správce). */
  url: z.string().max(500).default(""),
  label: optionalText(LIMITS.short),
  protected: z.boolean().default(false),
  /** Karta z Open Graph cíle (načítá server, viz `og.ts`); `null` = nenačteno. */
  card: galleryCardSchema.nullable().default(null),
});

const dataSchemas = {
  hero: z.object({ countdown: z.boolean().default(false), tagline: optionalText(LIMITS.short) }),
  program: z.object({ intro: optionalText() }),
  venue: z.object({
    venueIds: z.array(uuid).max(LIMITS.venues).default([]),
    intro: optionalText(),
    showMap: z.boolean().default(false),
  }),
  lodging: z.object({
    items: z
      .array(
        z.object({
          id: uuid,
          name: text(LIMITS.short),
          description: optionalText(),
          url: z.string().max(500).nullable().default(null),
        }),
      )
      .max(LIMITS.lodging)
      .default([]),
    transport: optionalText(),
  }),
  dresscode: z.object({ text: text().default({}) }),
  faq: z.object({
    items: z
      .array(z.object({ id: uuid, question: text(LIMITS.short), answer: text() }))
      .max(LIMITS.faq)
      .default([]),
  }),
  contact: z.object({
    people: z
      .array(
        z.object({
          id: uuid,
          name: z.string().max(LIMITS.name).default(""),
          role: optionalText(LIMITS.short),
          email: z.string().max(254).nullable().default(null),
          phone: z.string().max(40).nullable().default(null),
        }),
      )
      .max(LIMITS.contacts)
      .default([]),
  }),
  story: z.object({ text: text().default({}), mediaId: z.string().nullable().default(null) }),
  gifts: giftsDataSchema,
  gallery: z.object({
    /** Fotografie galerie v pořadí (identifikátory médií, `admin_media_list`); soubory a popisky jsou v tabulce media. */
    mediaIds: z.array(z.string()).max(60).default([]),
    /** Fotografie jsou jen pro hosty s PINem (ve veřejném snímku nejsou). */
    photosProtected: z.boolean().default(false),
    link: galleryLinkEditSchema.nullable().default(null),
  }),
  rsvp: z.object({ intro: optionalText() }),
} as const satisfies Record<BlockType, z.ZodType>;

export const editorBlockSchema = z.discriminatedUnion("type", [
  z.object({ ...blockBase, type: z.literal("hero"), data: dataSchemas.hero }),
  z.object({ ...blockBase, type: z.literal("program"), data: dataSchemas.program }),
  z.object({ ...blockBase, type: z.literal("venue"), data: dataSchemas.venue }),
  z.object({ ...blockBase, type: z.literal("lodging"), data: dataSchemas.lodging }),
  z.object({ ...blockBase, type: z.literal("dresscode"), data: dataSchemas.dresscode }),
  z.object({ ...blockBase, type: z.literal("faq"), data: dataSchemas.faq }),
  z.object({ ...blockBase, type: z.literal("contact"), data: dataSchemas.contact }),
  z.object({ ...blockBase, type: z.literal("story"), data: dataSchemas.story }),
  z.object({ ...blockBase, type: z.literal("gifts"), data: dataSchemas.gifts }),
  z.object({ ...blockBase, type: z.literal("gallery"), data: dataSchemas.gallery }),
  z.object({ ...blockBase, type: z.literal("rsvp"), data: dataSchemas.rsvp }),
]);
export type EditorBlock = z.infer<typeof editorBlockSchema>;
export type EditorBlockOf<T extends BlockType> = Extract<EditorBlock, { type: T }>;

// --- dokument ------------------------------------------------------------------------------

export const editorVenueSchema = z.object({
  id: uuid,
  name: text(LIMITS.short),
  address: z.string().max(250).default(""),
  isPrivate: z.boolean().default(false),
  directions: optionalText(),
  mapUrl: z.string().max(500).nullable().default(null),
  /** Souřadnice adresy pro mapu (hledá je editor po změně adresy); po úpravě adresy se mažou. */
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
});
export type EditorVenue = z.infer<typeof editorVenueSchema>;

export const eventKinds = ["ceremony", "reception", "other"] as const;

export const editorEventSchema = z.object({
  id: uuid,
  kind: z.enum(eventKinds),
  title: text(LIMITS.short),
  description: optionalText(),
  startsAt: isoDateTime,
  endsAt: isoDateTime.nullable().default(null),
  venueId: uuid.nullable().default(null),
  rsvpEnabled: z.boolean().default(false),
});
export type EditorEvent = z.infer<typeof editorEventSchema>;

export const editorDocSchema = z.object({
  wedding: z.object({
    partnerA: z.string().max(LIMITS.name),
    partnerB: z.string().max(LIMITS.name),
    startsOn: z.union([z.literal(""), isoDate]),
    endsOn: isoDate.nullable().default(null),
    timezone: z.string().min(1).max(64).default("Europe/Prague"),
    locales: z.array(localeSchema).min(1).max(locales.length),
    defaultLocale: localeSchema,
    template: z.enum(templateKeys),
    palette: z.string().min(1).max(40),
  }),
  venues: z.array(editorVenueSchema).max(LIMITS.venues),
  events: z.array(editorEventSchema).max(LIMITS.events),
  blocks: z.array(editorBlockSchema).max(blockTypes.length),
});
export type EditorDoc = z.infer<typeof editorDocSchema>;

/** Výchozí kotvy bloků (stejné jako v průvodci). */
export const BLOCK_ANCHORS: Record<BlockType, string> = {
  hero: "uvod",
  program: "program",
  venue: "misto",
  lodging: "ubytovani",
  dresscode: "dresscode",
  faq: "faq",
  contact: "kontakt",
  story: "pribeh",
  gifts: "dary",
  gallery: "galerie",
  rsvp: "potvrdit-ucast",
};

/** Bloky, které se po zapnutí nechávají hostům za PINem (obsah není ve veřejném snímku). */
export const SENSITIVE_BLOCKS: readonly BlockType[] = ["gifts"];

export function newId(): string {
  return crypto.randomUUID();
}

export function defaultBlockData<T extends BlockType>(type: T): EditorBlockOf<T>["data"] {
  return dataSchemas[type].parse(
    type === "hero" ? { countdown: true } : type === "gifts" ? {} : {},
  ) as EditorBlockOf<T>["data"];
}

/** Vypnutý prázdný blok daného druhu (zapnutí v editoru ho jen zviditelní). */
export function emptyBlock(type: BlockType, position: number): EditorBlock {
  return editorBlockSchema.parse({
    id: newId(),
    type,
    anchor: BLOCK_ANCHORS[type],
    enabled: type === "hero",
    position,
    sensitive: SENSITIVE_BLOCKS.includes(type),
    data: defaultBlockData(type),
  });
}

/**
 * Doplní chybějící bloky (editor vždy nabízí všech 11 druhů), sjednotí kotvy a pořadí. Úvod je vždy
 * první a zapnutý (jména jsou jediný `h1` stránky). Každý druh je v dokumentu nejvýš jednou.
 */
export function normalizeBlocks(blocks: readonly EditorBlock[]): EditorBlock[] {
  const byType = new Map<BlockType, EditorBlock>();
  for (const block of [...blocks].sort((a, b) => a.position - b.position)) {
    if (!byType.has(block.type)) byType.set(block.type, block);
  }
  const ordered: EditorBlock[] = [];
  const hero = byType.get("hero") ?? emptyBlock("hero", 0);
  ordered.push({ ...hero, enabled: true });
  for (const block of [...byType.values()].filter((b) => b.type !== "hero")) ordered.push(block);
  for (const type of blockTypes) {
    if (!byType.has(type) && type !== "hero") ordered.push(emptyBlock(type, ordered.length));
  }
  return ordered.map((block, index) => ({
    ...block,
    anchor: BLOCK_ANCHORS[block.type],
    sensitive: SENSITIVE_BLOCKS.includes(block.type) ? true : block.sensitive,
    position: index + 1,
  })) as EditorBlock[];
}

// --- řazení bloků (tlačítka nahoru a dolů i přetažení, WCAG 2.5.7) -----------------------------

/** Úvod je vždy první: ostatní bloky se řadí pod ním. */
export function moveBlock(
  blocks: readonly EditorBlock[],
  id: string,
  delta: -1 | 1,
): EditorBlock[] {
  const hero: EditorBlock[] = blocks.filter((block) => block.type === "hero");
  const rest: EditorBlock[] = blocks.filter((block) => block.type !== "hero");
  const index = rest.findIndex((block) => block.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= rest.length) return [...blocks];
  const next = [...rest];
  [next[index], next[target]] = [next[target], next[index]];
  return renumber([...hero, ...next]);
}

/** Přesun na zadané místo mezi neúvodními bloky (přetažení myší). */
export function moveBlockTo(
  blocks: readonly EditorBlock[],
  id: string,
  targetId: string,
): EditorBlock[] {
  const hero: EditorBlock[] = blocks.filter((block) => block.type === "hero");
  const rest: EditorBlock[] = blocks.filter((block) => block.type !== "hero");
  const from = rest.findIndex((block) => block.id === id);
  const to = rest.findIndex((block) => block.id === targetId);
  if (from < 0 || to < 0 || from === to) return [...blocks];
  const next = [...rest];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return renumber([...hero, ...next]);
}

function renumber(blocks: EditorBlock[]): EditorBlock[] {
  return blocks.map((block, index) => ({ ...block, position: index + 1 }));
}

export function setBlockEnabled(
  blocks: readonly EditorBlock[],
  id: string,
  enabled: boolean,
): EditorBlock[] {
  return blocks.map((block) =>
    block.id === id && block.type !== "hero" ? { ...block, enabled } : block,
  );
}

// --- převody: databáze, DB payload ---------------------------------------------------------------

const loadSchema = z.object({
  wedding: z.object({
    id: z.string(),
    status: z.string(),
    slug: z.string().nullable(),
    default_locale: localeSchema,
    locales: z.array(localeSchema).min(1),
    template: z.string(),
    palette: z.string(),
    partner_a_name: z.string(),
    partner_b_name: z.string(),
    starts_on: z.string().nullable(),
    ends_on: z.string().nullable(),
    timezone: z.string(),
    quick_notice: text(500).nullable(),
    quick_notice_enabled: z.boolean(),
    guest_pin_enabled: z.boolean(),
    has_guest_pin: z.boolean(),
    site_rev: z.number().int(),
    draft_saved_at: z.string().nullable(),
    published_at: z.string().nullable(),
    published_version_no: z.number().int().nullable(),
    published_version_at: z.string().nullable(),
    has_unpublished_changes: z.boolean(),
  }),
  venues: z.array(
    z.object({
      id: z.string(),
      name: z.unknown(),
      address: z.string(),
      is_private: z.boolean(),
      directions: z.unknown(),
      map_url: z.string().nullable(),
      lat: z.number().nullable().optional(),
      lng: z.number().nullable().optional(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(eventKinds),
      title: z.unknown(),
      description: z.unknown(),
      starts_at: z.string(),
      ends_at: z.string().nullable(),
      venue_id: z.string().nullable(),
      rsvp_enabled: z.boolean(),
    }),
  ),
  blocks: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      anchor: z.string(),
      enabled: z.boolean(),
      position: z.number(),
      sensitive: z.boolean(),
      data: z.unknown(),
    }),
  ),
  versions: z.array(
    z.object({
      id: z.string(),
      version_no: z.number().int(),
      kind: z.enum(["publish", "checkpoint"]),
      note: z.string().nullable(),
      created_at: z.string(),
      is_published: z.boolean(),
      by_me: z.boolean(),
    }),
  ),
});

export interface SiteMeta {
  weddingId: string;
  status: string;
  slug: string | null;
  rev: number;
  hasGuestPin: boolean;
  guestPinEnabled: boolean;
  quickNotice: I18nText | null;
  quickNoticeEnabled: boolean;
  publishedVersionNo: number | null;
  publishedVersionAt: string | null;
  hasUnpublishedChanges: boolean;
  draftSavedAt: string | null;
}

export interface SiteVersionInfo {
  id: string;
  versionNo: number;
  kind: "publish" | "checkpoint";
  note: string | null;
  createdAt: string;
  isPublished: boolean;
  byMe: boolean;
}

export interface LoadedSite {
  doc: EditorDoc;
  meta: SiteMeta;
  versions: SiteVersionInfo[];
}

/** Odpověď `admin_site_load` na dokument; poškozená data nikdy nevyhodí, zahodí se (blok se vrátí prázdný). */
export function parseLoaded(raw: unknown): LoadedSite | null {
  const parsed = loadSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { wedding, venues, events, blocks, versions } = parsed.data;

  const template = isTemplateKey(wedding.template) ? wedding.template : "editorial";
  const doc = editorDocSchema.safeParse({
    wedding: {
      partnerA: wedding.partner_a_name,
      partnerB: wedding.partner_b_name,
      startsOn: wedding.starts_on ?? "",
      endsOn: wedding.ends_on,
      timezone: wedding.timezone,
      locales: wedding.locales,
      defaultLocale: wedding.default_locale,
      template,
      palette: wedding.palette,
    },
    venues: venues.map((v) => ({
      id: v.id,
      name: v.name ?? {},
      address: v.address,
      isPrivate: v.is_private,
      directions: v.directions ?? null,
      mapUrl: v.map_url,
      lat: v.lat ?? null,
      lng: v.lng ?? null,
    })),
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title ?? {},
      description: e.description ?? null,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      venueId: e.venue_id,
      rsvpEnabled: e.rsvp_enabled,
    })),
    blocks: blocks.flatMap((b) => {
      const type = b.type as BlockType;
      if (!blockTypes.includes(type)) return [];
      const block = editorBlockSchema.safeParse({
        id: b.id,
        type,
        anchor: b.anchor,
        enabled: b.enabled,
        position: Math.max(0, Math.round(b.position)),
        sensitive: b.sensitive,
        data: b.data ?? {},
      });
      // Poškozená data bloku se nahradí prázdným blokem téhož druhu (vypnutým).
      return [block.success ? block.data : { ...emptyBlock(type, b.position), id: b.id }];
    }),
  });
  if (!doc.success) return null;

  return {
    doc: { ...doc.data, blocks: normalizeBlocks(doc.data.blocks) },
    meta: {
      weddingId: wedding.id,
      status: wedding.status,
      slug: wedding.slug,
      rev: wedding.site_rev,
      hasGuestPin: wedding.has_guest_pin,
      guestPinEnabled: wedding.guest_pin_enabled,
      quickNotice: wedding.quick_notice,
      quickNoticeEnabled: wedding.quick_notice_enabled,
      publishedVersionNo: wedding.published_version_no,
      publishedVersionAt: wedding.published_version_at,
      hasUnpublishedChanges: wedding.has_unpublished_changes,
      draftSavedAt: wedding.draft_saved_at,
    },
    versions: versions.map((v) => ({
      id: v.id,
      versionNo: v.version_no,
      kind: v.kind,
      note: v.note,
      createdAt: v.created_at,
      isPublished: v.is_published,
      byMe: v.by_me,
    })),
  };
}

/** Normalizace vstupů, které web přijme jen v určitém tvaru (odkazy, telefony, e-maily). */
function cleanDoc(doc: EditorDoc): EditorDoc {
  const trim = (value: I18nText | null): I18nText | null => cleanText(value);
  return {
    ...doc,
    wedding: {
      ...doc.wedding,
      partnerA: doc.wedding.partnerA.trim(),
      partnerB: doc.wedding.partnerB.trim(),
    },
    venues: doc.venues.map((venue) => ({
      ...venue,
      name: cleanText(venue.name) ?? {},
      address: venue.address.trim(),
      directions: trim(venue.directions),
      mapUrl: venue.mapUrl ? (normalizeUrl(venue.mapUrl) ?? venue.mapUrl.trim()) : null,
      // Soukromé místo na mapě nikdy není: souřadnice se neukládají ani do pracovní kopie.
      lat: venue.isPrivate ? null : venue.lat,
      lng: venue.isPrivate ? null : venue.lng,
    })),
    events: doc.events.map((event) => ({
      ...event,
      title: cleanText(event.title) ?? {},
      description: trim(event.description),
    })),
    blocks: doc.blocks,
  };
}

/** Prázdné jazyky textu se zahodí; text bez obsahu je `null`. */
export function cleanText(value: I18nText | null | undefined): I18nText | null {
  if (!value) return null;
  const out: I18nText = {};
  for (const locale of locales) {
    const part = value[locale]?.trim();
    if (part) out[locale] = part;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Tvar pro `admin_site_save` (databáze ukládá texty tak, jak jsou, jen bez prázdných jazyků). */
export function docToWork(doc: EditorDoc): unknown {
  const clean = cleanDoc(doc);
  return {
    wedding: clean.wedding,
    venues: clean.venues,
    events: clean.events,
    blocks: normalizeBlocks(clean.blocks).map((block) => ({
      id: block.id,
      type: block.type,
      anchor: block.anchor,
      enabled: block.enabled,
      position: block.position,
      sensitive: block.sensitive,
      data: block.data,
    })),
  };
}

// --- kontrola ---------------------------------------------------------------------------------

export type IssueCode =
  | "names"
  | "date"
  | "dateOrder"
  | "defaultLocale"
  | "palette"
  | "venueAddress"
  | "venueName"
  | "venueUrl"
  | "venueNone"
  | "venueNoCoords"
  | "eventTitle"
  | "eventTime"
  | "eventVenue"
  | "dresscodeEmpty"
  | "storyEmpty"
  | "giftsAccount"
  | "galleryUrl"
  | "photoNoCaption"
  | "lodgingUrl"
  | "lodgingName"
  | "faqIncomplete"
  | "contactName"
  | "contactEmail"
  | "contactPhone"
  | "emptyBlock"
  | "guestPinMissing"
  | "build";

export interface Issue {
  code: IssueCode;
  /** `error` brání zveřejnění, `warning` jen upozorní. */
  severity: "error" | "warning";
  /** Druh bloku (nebo `wedding`, `events`, `venues`), ke kterému chyba patří; podle něj se skáče na formulář. */
  area: BlockType | "wedding" | "events" | "venues";
  /** Identifikátor položky (událost, místo) uvnitř oblasti. */
  itemId?: string;
}

export interface ValidateContext {
  /** PIN hostů je nastavený (zapnutý a s hodnotou). Bez něj citlivé údaje nikdo neuvidí. */
  guestPinReady: boolean;
  /** Média svatby (`admin_media_list`); bez nich se fotografie nekontrolují (starší volání, testy). */
  media?: readonly MediaItem[];
}

function filled(value: I18nText | null | undefined, locale: Locale): boolean {
  return Boolean(value?.[locale]?.trim());
}

function anyFilled(value: I18nText | null | undefined): boolean {
  return locales.some((locale) => filled(value, locale));
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Adresa soukromého místa nebo chráněného odkazu je bez PINu hostů nikomu neviditelná. */
export function usesSensitive(doc: EditorDoc): boolean {
  const venueBlock = doc.blocks.find((b) => b.type === "venue" && b.enabled);
  const gifts = doc.blocks.find((b) => b.type === "gifts" && b.enabled);
  const gallery = doc.blocks.find((b) => b.type === "gallery" && b.enabled);
  const privateVenue =
    venueBlock?.type === "venue" &&
    doc.venues.some((v) => v.isPrivate && venueBlock.data.venueIds.includes(v.id));
  return Boolean(
    privateVenue ||
    gifts ||
    (gallery?.type === "gallery" &&
      (gallery.data.link?.protected === true || gallery.data.photosProtected)),
  );
}

/** Hotové fotografie (ne obrázky karet) z uvedených identifikátorů v pořadí, bez duplicit. */
function galleryPhotos(
  ids: readonly string[],
  media: readonly MediaItem[] | undefined,
): MediaItem[] {
  if (!media) return [];
  const byId = new Map(media.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item || item.kind !== "photo" || !isReady(item) || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

/**
 * Pořadí fotografií v galerii sjednocené s tabulkou médií: zůstanou jen hotové fotografie, které existují (smazané
 * zmizí), v pořadí z dokumentu; fotografie, které v dokumentu ještě nejsou (nahrané těsně před zavřením okna, než
 * se uložil koncept), přibudou na konec. Galerie obsahuje všechny hotové fotografie svatby. Vrací stejný objekt,
 * když se nic nemění.
 */
export function reconcileGalleryMedia(doc: EditorDoc, media: readonly MediaItem[]): EditorDoc {
  const ready = media.filter((item) => item.kind === "photo" && isReady(item));
  const readyIds = new Set(ready.map((item) => item.id));
  let changed = false;
  const blocks = doc.blocks.map((block) => {
    if (block.type !== "gallery") return block;
    const kept = block.data.mediaIds.filter(
      (id, i, all) => readyIds.has(id) && all.indexOf(id) === i,
    );
    const missing = ready.map((item) => item.id).filter((id) => !kept.includes(id));
    const ids = [...kept, ...missing];
    if (
      ids.length === block.data.mediaIds.length &&
      ids.every((id, i) => id === block.data.mediaIds[i])
    ) {
      return block;
    }
    changed = true;
    return { ...block, data: { ...block.data, mediaIds: ids } };
  });
  return changed ? { ...doc, blocks } : doc;
}

/**
 * Fotografie se smí zveřejnit, když má popisek aspoň v jednom jazyce, nebo je dekorativní (prázdný `alt`).
 * Chybějící překlad zveřejnění nebrání (zobrazí se dostupný jazyk a správce se o tom dozví).
 */
export function publishable(item: MediaItem): boolean {
  return item.decorative || anyFilled(item.alt);
}

export function validateDoc(doc: EditorDoc, context: ValidateContext): Issue[] {
  const issues: Issue[] = [];
  const add = (issue: Issue) => issues.push(issue);
  const { wedding } = doc;
  const defaults = wedding.defaultLocale;

  if (!wedding.partnerA.trim() || !wedding.partnerB.trim()) {
    add({ code: "names", severity: "error", area: "wedding" });
  }
  if (!isIsoDate(wedding.startsOn)) add({ code: "date", severity: "error", area: "wedding" });
  else if (wedding.endsOn && (!isIsoDate(wedding.endsOn) || wedding.endsOn < wedding.startsOn)) {
    add({ code: "dateOrder", severity: "error", area: "wedding" });
  }
  if (!wedding.locales.includes(wedding.defaultLocale)) {
    add({ code: "defaultLocale", severity: "error", area: "wedding" });
  }
  if (!hasPalette(wedding.template, wedding.palette)) {
    add({ code: "palette", severity: "error", area: "wedding" });
  } else if (!validateTemplatePalette(wedding.template, wedding.palette).ok) {
    add({ code: "palette", severity: "error", area: "wedding" });
  }

  for (const venue of doc.venues) {
    if (!anyFilled(venue.name))
      add({ code: "venueName", severity: "error", area: "venues", itemId: venue.id });
    if (venue.address.trim() === "") {
      add({ code: "venueAddress", severity: "error", area: "venues", itemId: venue.id });
    }
    if (venue.mapUrl && normalizeHttpsOrHttp(venue.mapUrl) === null) {
      add({ code: "venueUrl", severity: "error", area: "venues", itemId: venue.id });
    }
  }

  for (const event of doc.events) {
    if (!filled(event.title, defaults) && !anyFilled(event.title)) {
      add({ code: "eventTitle", severity: "error", area: "events", itemId: event.id });
    }
    if (event.endsAt && Date.parse(event.endsAt) < Date.parse(event.startsAt)) {
      add({ code: "eventTime", severity: "error", area: "events", itemId: event.id });
    }
    if (event.venueId && !doc.venues.some((v) => v.id === event.venueId)) {
      add({ code: "eventVenue", severity: "error", area: "events", itemId: event.id });
    }
  }

  for (const block of doc.blocks) {
    if (!block.enabled) continue;
    switch (block.type) {
      case "program":
        if (doc.events.length === 0)
          add({ code: "emptyBlock", severity: "warning", area: "program" });
        break;
      case "venue": {
        const shown = doc.venues.filter((v) => block.data.venueIds.includes(v.id));
        if (shown.length === 0) add({ code: "venueNone", severity: "warning", area: "venue" });
        if (block.data.showMap && !shown.some((v) => !v.isPrivate && v.lat !== null)) {
          add({ code: "venueNoCoords", severity: "warning", area: "venue" });
        }
        break;
      }
      case "dresscode":
        if (!anyFilled(block.data.text))
          add({ code: "dresscodeEmpty", severity: "warning", area: "dresscode" });
        break;
      case "story":
        if (!anyFilled(block.data.text))
          add({ code: "storyEmpty", severity: "warning", area: "story" });
        break;
      case "lodging": {
        for (const item of block.data.items) {
          if (!anyFilled(item.name))
            add({ code: "lodgingName", severity: "error", area: "lodging", itemId: item.id });
          if (item.url && normalizeUrl(item.url) === null) {
            add({ code: "lodgingUrl", severity: "error", area: "lodging", itemId: item.id });
          }
        }
        if (block.data.items.length === 0 && !anyFilled(block.data.transport)) {
          add({ code: "emptyBlock", severity: "warning", area: "lodging" });
        }
        break;
      }
      case "faq": {
        for (const item of block.data.items) {
          if (!anyFilled(item.question) || !anyFilled(item.answer)) {
            add({ code: "faqIncomplete", severity: "warning", area: "faq", itemId: item.id });
          }
        }
        if (block.data.items.length === 0)
          add({ code: "emptyBlock", severity: "warning", area: "faq" });
        break;
      }
      case "contact": {
        for (const person of block.data.people) {
          if (!person.name.trim())
            add({ code: "contactName", severity: "error", area: "contact", itemId: person.id });
          if (person.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(person.email.trim())) {
            add({ code: "contactEmail", severity: "error", area: "contact", itemId: person.id });
          }
          if (person.phone && normalizePhone(person.phone) === null) {
            add({ code: "contactPhone", severity: "error", area: "contact", itemId: person.id });
          }
        }
        if (block.data.people.length === 0)
          add({ code: "emptyBlock", severity: "warning", area: "contact" });
        break;
      }
      case "gifts":
        if (resolveAccount(block.data.account) === null) {
          add({ code: "giftsAccount", severity: "error", area: "gifts" });
        }
        break;
      case "gallery": {
        const link = block.data.link;
        const photos = galleryPhotos(block.data.mediaIds, context.media);
        // Fotografie bez popisku a bez příznaku dekorativní se nezveřejní (ADR 0006, WCAG 1.1.1): upozornění
        for (const photo of photos) {
          if (!publishable(photo)) {
            add({ code: "photoNoCaption", severity: "warning", area: "gallery", itemId: photo.id });
          }
        }
        if (link) {
          if (normalizeHttpsUrl(link.url) === null)
            add({ code: "galleryUrl", severity: "error", area: "gallery" });
        } else if (!photos.some(publishable)) {
          add({ code: "emptyBlock", severity: "warning", area: "gallery" });
        }
        break;
      }
      default:
        break;
    }
  }

  if (usesSensitive(doc) && !context.guestPinReady) {
    add({ code: "guestPinMissing", severity: "warning", area: "gifts" });
  }
  return issues;
}

function normalizeHttpsOrHttp(raw: string): string | null {
  return normalizeUrl(raw);
}

// --- překlady -------------------------------------------------------------------------------

export interface TranslationGap {
  /** Oblast webu (druh bloku, `events` nebo `venues`). */
  area: BlockType | "events" | "venues";
  locale: Locale;
  /** Počet textů, které v jazyce chybí, i když jsou v jiném jazyce vyplněné. */
  count: number;
}

/**
 * Chybějící překlady (FR-WEB-2): text vyplněný aspoň v jednom jazyce, který v jiném jazyce webu
 * chybí. Web v takovém případě ukáže dostupný jazyk (`pick`), správce se o tom dozví tady.
 * Zcela prázdné nepovinné texty se nehlásí (pole se prostě nepoužívá).
 */
export function translationGaps(doc: EditorDoc, media?: readonly MediaItem[]): TranslationGap[] {
  const counts = new Map<string, TranslationGap>();
  const note = (area: TranslationGap["area"], value: I18nText | null | undefined) => {
    if (!anyFilled(value)) return;
    for (const locale of missingLocales(value, doc.wedding.locales)) {
      const key = `${area}:${locale}`;
      const gap = counts.get(key) ?? { area, locale, count: 0 };
      gap.count += 1;
      counts.set(key, gap);
    }
  };

  for (const venue of doc.venues) {
    note("venues", venue.name);
    note("venues", venue.directions);
  }
  for (const event of doc.events) {
    note("events", event.title);
    note("events", event.description);
  }
  for (const block of doc.blocks) {
    if (!block.enabled) continue;
    switch (block.type) {
      case "hero":
        note("hero", block.data.tagline);
        break;
      case "program":
      case "venue":
      case "rsvp":
      case "gifts":
        note(block.type, block.data.intro);
        break;
      case "lodging":
        note("lodging", block.data.transport);
        for (const item of block.data.items) {
          note("lodging", item.name);
          note("lodging", item.description);
        }
        break;
      case "dresscode":
      case "story":
        note(block.type, block.data.text);
        break;
      case "faq":
        for (const item of block.data.items) {
          note("faq", item.question);
          note("faq", item.answer);
        }
        break;
      case "contact":
        for (const person of block.data.people) note("contact", person.role);
        break;
      case "gallery":
        if (block.data.link) note("gallery", block.data.link.label);
        // Popisky fotografií (jen dekorativní se nepopisují); chybějící překlad se hlásí stejně jako u textů
        for (const photo of galleryPhotos(block.data.mediaIds, media)) {
          if (!photo.decorative) note("gallery", photo.alt);
        }
        break;
    }
  }
  return [...counts.values()].sort((a, b) =>
    a.area === b.area ? a.locale.localeCompare(b.locale) : a.area.localeCompare(b.area),
  );
}

// --- číslo účtu -------------------------------------------------------------------------------

export interface ResolvedAccount {
  /** Zobrazené číslo účtu (tuzemský tvar, nebo IBAN u zahraničního účtu). */
  account: string;
  iban: string;
}

/** Tuzemské číslo účtu nebo IBAN na dvojici pro web; neplatný vstup je `null`. */
export function resolveAccount(raw: string): ResolvedAccount | null {
  const value = raw.trim();
  if (value === "") return null;
  if (isValidCzAccount(value)) {
    const iban = czAccountToIban(value);
    return iban ? { account: value.replace(/\s+/g, ""), iban } : null;
  }
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (/^[A-Z]{2}\d{2}/.test(compact) && isValidIban(compact))
    return { account: compact, iban: compact };
  return null;
}

// --- sestavení snímku ---------------------------------------------------------------------------

export interface BuiltSnapshot {
  content: PublicContent;
  sensitive: SensitiveContent;
}

export interface BuildOptions {
  slug: string;
  quickNotice?: I18nText | null;
  phase?: Phase;
  now?: Date;
  /**
   * Média svatby (`admin_media_list`). Do snímku se dostanou jen hotová, zveřejnitelná a použitá v zapnutém bloku
   * (fotografie bez popisku a bez příznaku dekorativní se vynechají). Bez zadání (starší volání, testy) zůstane
   * `media` prázdné a odkazy na média beze změny.
   */
  media?: readonly MediaItem[];
}

function toPublicMedia(item: MediaItem): PublicMedia {
  const largest = item.widths[item.widths.length - 1];
  return {
    id: item.id,
    src: mediaSrc(item.id, largest),
    width: item.width ?? 1,
    height: item.height ?? 1,
    // Obrázek karty je vždy dekorativní a bez popisku
    alt: item.kind === "card" ? null : cleanText(item.alt),
    decorative: item.kind === "card" ? true : item.decorative,
    widths: item.widths,
  };
}

/**
 * Zveřejnitelný snímek a citlivá část z dokumentu. Neplatný dokument (`validateDoc` hlásí chybu)
 * vrací `null`: zveřejnit jde jen to, co prošlo schématem veřejného snímku.
 */
export function docToPublic(doc: EditorDoc, options: BuildOptions): BuiltSnapshot | null {
  const clean = cleanDoc(doc);
  const sensitiveVenues: SensitiveContent["venues"] = {};
  const venueBlock = clean.blocks.find((b) => b.type === "venue");
  const listedVenue = (id: string) =>
    venueBlock?.type === "venue" && venueBlock.data.venueIds.includes(id);

  const venues = clean.venues.map((venue) => {
    const mapUrl = venue.mapUrl ? normalizeUrl(venue.mapUrl) : null;
    if (venue.isPrivate) {
      if (venue.address) {
        sensitiveVenues[venue.id] = {
          address: venue.address,
          mapUrl,
          directions: venue.directions,
        };
      }
      return {
        id: venue.id,
        name: venue.name,
        address: null,
        isPrivate: true,
        directions: null,
        mapUrl: null,
        lat: null,
        lng: null,
      };
    }
    const located = venue.lat !== null && venue.lng !== null;
    return {
      id: venue.id,
      name: venue.name,
      address: venue.address || null,
      isPrivate: false,
      directions: venue.directions,
      mapUrl,
      lat: located ? venue.lat : null,
      lng: located ? venue.lng : null,
    };
  });

  let giftsSensitive: SensitiveContent["gifts"] = null;
  let gallerySensitive: SensitiveContent["gallery"] = null;

  // Média do snímku: veřejná v `content.media`, chráněná PINem v `sensitive.photos` (stejné pořadí jako v galerii)
  const mediaGiven = options.media !== undefined;
  const mediaById = new Map((options.media ?? []).filter(isReady).map((item) => [item.id, item]));
  const publicMedia: PublicMedia[] = [];
  const sensitivePhotos: PublicMedia[] = [];
  const addMedia = (target: PublicMedia[], item: MediaItem) => {
    if (!target.some((m) => m.id === item.id)) target.push(toPublicMedia(item));
  };

  const blocks = normalizeBlocks(clean.blocks).map((block) => {
    const base = {
      id: block.id,
      anchor: block.anchor,
      enabled: block.enabled,
      position: block.position,
      sensitive: block.sensitive,
    };
    switch (block.type) {
      case "gifts": {
        const resolved = resolveAccount(block.data.account);
        if (resolved && block.enabled) {
          giftsSensitive = {
            account: resolved.account,
            iban: resolved.iban,
            holder: block.data.holder?.trim() || null,
            paymentMessage: block.data.paymentMessage?.trim() || null,
          };
        }
        return { ...base, type: block.type, data: { intro: cleanText(block.data.intro) } };
      }
      case "gallery": {
        const link = block.data.link;
        const url = link ? normalizeHttpsUrl(link.url) : null;
        // Kopie obrázku karty: jen hotové médium druhu card a jen když se karta načetla
        const cardImage =
          mediaGiven && link?.card?.status === "ok" && link.card.imageMediaId
            ? mediaById.get(link.card.imageMediaId)
            : undefined;
        const card = link?.card
          ? {
              ...link.card,
              imageMediaId:
                cardImage?.kind === "card"
                  ? cardImage.id
                  : mediaGiven
                    ? null
                    : link.card.imageMediaId,
            }
          : null;
        const publicLink =
          link && url
            ? {
                url: link.protected ? null : url,
                label: cleanText(link.label),
                protected: link.protected,
                card: link.protected ? null : card,
              }
            : null;
        if (link && url && link.protected && block.enabled) gallerySensitive = { url, card };

        // Fotografie: jen z hotových, zveřejnitelných a jen ze zapnutého bloku
        let mediaIds = block.data.mediaIds;
        if (mediaGiven) {
          mediaIds = block.enabled
            ? galleryPhotos(block.data.mediaIds, options.media)
                .filter(publishable)
                .map((item) => item.id)
            : [];
          const target = block.data.photosProtected ? sensitivePhotos : publicMedia;
          for (const id of mediaIds) addMedia(target, mediaById.get(id)!);
          if (block.enabled && cardImage?.kind === "card" && url) {
            addMedia(link?.protected ? sensitivePhotos : publicMedia, cardImage);
          }
        }
        return {
          ...base,
          type: block.type,
          data: {
            // Chráněné fotografie nejsou ve veřejném snímku ani jako identifikátory
            mediaIds: block.data.photosProtected ? [] : mediaIds,
            photosProtected: block.data.photosProtected,
            link: publicLink,
          },
        };
      }
      case "hero":
        return {
          ...base,
          type: block.type,
          data: { countdown: block.data.countdown, tagline: cleanText(block.data.tagline) },
        };
      case "program":
      case "rsvp":
        return { ...base, type: block.type, data: { intro: cleanText(block.data.intro) } };
      case "venue":
        return {
          ...base,
          type: block.type,
          data: {
            venueIds: block.data.venueIds.filter((id) => venues.some((v) => v.id === id)),
            intro: cleanText(block.data.intro),
            showMap: block.data.showMap,
          },
        };
      case "lodging":
        return {
          ...base,
          type: block.type,
          data: {
            items: block.data.items
              .filter((item) => anyFilled(item.name))
              .map((item) => ({
                id: item.id,
                name: cleanText(item.name) ?? {},
                description: cleanText(item.description),
                url: item.url ? normalizeUrl(item.url) : null,
              })),
            transport: cleanText(block.data.transport),
          },
        };
      case "dresscode":
        return { ...base, type: block.type, data: { text: cleanText(block.data.text) ?? {} } };
      case "faq":
        return {
          ...base,
          type: block.type,
          data: {
            items: block.data.items
              .filter((item) => anyFilled(item.question) && anyFilled(item.answer))
              .map((item) => ({
                id: item.id,
                question: cleanText(item.question) ?? {},
                answer: cleanText(item.answer) ?? {},
              })),
          },
        };
      case "contact":
        return {
          ...base,
          type: block.type,
          data: {
            people: block.data.people
              .filter((person) => person.name.trim() !== "")
              .map((person) => ({
                id: person.id,
                name: person.name.trim(),
                role: cleanText(person.role),
                email: person.email?.trim() || null,
                phone: person.phone ? normalizePhone(person.phone) : null,
              })),
          },
        };
      case "story": {
        // Obrázek příběhu: s přehledem médií jen hotové zveřejnitelné médium (jinak žádný obrázek)
        const image =
          mediaGiven && block.data.mediaId ? mediaById.get(block.data.mediaId) : undefined;
        const usable = image && image.kind === "photo" && publishable(image) && block.enabled;
        if (usable) addMedia(publicMedia, image);
        return {
          ...base,
          type: block.type,
          data: {
            text: cleanText(block.data.text) ?? {},
            mediaId: mediaGiven ? (usable ? image.id : null) : block.data.mediaId,
          },
        };
      }
    }
  });

  const events = clean.events
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      title: event.title,
      description: event.description,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      venueId: event.venueId,
      rsvpEnabled: event.rsvpEnabled,
    }))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  void listedVenue;
  const content = publicContentSchema.safeParse({
    version: 1,
    slug: options.slug,
    partners: { a: clean.wedding.partnerA, b: clean.wedding.partnerB },
    startsOn: clean.wedding.startsOn,
    endsOn: clean.wedding.endsOn,
    timezone: clean.wedding.timezone,
    locales: clean.wedding.locales,
    defaultLocale: clean.wedding.defaultLocale,
    template: clean.wedding.template,
    palette: clean.wedding.palette,
    phase:
      options.phase ??
      phaseFromDates(
        { startsOn: clean.wedding.startsOn, endsOn: clean.wedding.endsOn },
        options.now ?? new Date(),
        clean.wedding.timezone,
      ),
    quickNotice: cleanText(options.quickNotice ?? null),
    thanksMessage: null,
    venues,
    events,
    media: publicMedia,
    blocks,
  });
  if (!content.success) return null;

  const sensitive = sensitiveContentSchema.safeParse({
    venues: sensitiveVenues,
    gifts: giftsSensitive,
    gallery: gallerySensitive,
    photos: sensitivePhotos,
  });
  if (!sensitive.success) return null;
  return { content: content.data, sensitive: sensitive.data };
}

// --- vrácení verze -------------------------------------------------------------------------------

/**
 * Dokument ze snímku verze (vrácení verze, inicializace pracovní kopie ze zveřejněné verze):
 * soukromé adresy, číslo účtu a chráněný odkaz se vrátí z citlivé části k místům a blokům.
 */
export function publicToDoc(content: PublicContent, sensitive: SensitiveContent): EditorDoc {
  const venues = content.venues.map((venue) => {
    const secret = venue.isPrivate ? sensitive.venues[venue.id] : undefined;
    return {
      id: venue.id,
      name: venue.name,
      address: secret?.address ?? venue.address ?? "",
      isPrivate: venue.isPrivate,
      directions: secret?.directions ?? venue.directions,
      mapUrl: secret?.mapUrl ?? venue.mapUrl,
      lat: venue.lat,
      lng: venue.lng,
    };
  });
  const blocks = content.blocks.map((block): unknown => {
    switch (block.type) {
      case "gifts":
        return {
          ...block,
          data: {
            intro: block.data.intro,
            account: sensitive.gifts?.account ?? "",
            holder: sensitive.gifts?.holder ?? null,
            paymentMessage: sensitive.gifts?.paymentMessage ?? null,
          },
        };
      case "gallery": {
        const link = block.data.link;
        // Chráněné fotografie (bez obrázku karty) se vrací z citlivé části v původním pořadí
        const cardImageId = (link?.protected ? sensitive.gallery?.card : link?.card)?.imageMediaId;
        return {
          ...block,
          data: {
            mediaIds: block.data.photosProtected
              ? sensitive.photos.map((m) => m.id).filter((id) => id !== cardImageId)
              : block.data.mediaIds,
            photosProtected: block.data.photosProtected,
            link: link
              ? {
                  url: link.protected ? (sensitive.gallery?.url ?? "") : (link.url ?? ""),
                  label: link.label,
                  protected: link.protected,
                  card: link.protected ? (sensitive.gallery?.card ?? null) : link.card,
                }
              : null,
          },
        };
      }
      default:
        return block;
    }
  });
  const doc = editorDocSchema.parse({
    wedding: {
      partnerA: content.partners.a,
      partnerB: content.partners.b,
      startsOn: content.startsOn,
      endsOn: content.endsOn,
      timezone: content.timezone,
      locales: content.locales,
      defaultLocale: content.defaultLocale,
      template: content.template,
      palette: content.palette,
    },
    venues,
    events: content.events.map((event) => ({
      id: event.id,
      kind: event.kind,
      title: event.title,
      description: event.description,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      venueId: event.venueId,
      rsvpEnabled: event.rsvpEnabled ?? event.kind !== "other",
    })),
    blocks,
  });
  return { ...doc, blocks: normalizeBlocks(doc.blocks) };
}

export { httpsUrl };
