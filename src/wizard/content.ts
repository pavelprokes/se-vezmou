import type { Locale } from "@/i18n/config";
import type { I18nText } from "@/site/i18n-text";
import {
  publicContentSchema,
  sensitiveContentSchema,
  type Block,
  type Phase,
  type PublicContent,
  type SensitiveContent,
} from "@/site/types";
import type { PlaceDraft, WizardDraft } from "./draft";
import { normalizePhone, normalizeUrl } from "./normalize";
import { phaseFromDates } from "@/site/phase";
import { addDays, DEFAULT_TIMEZONE, endOfDayIso, todayIn, zonedIso } from "./zoned";

/**
 * Převod konceptu průvodce na obsah webu. Jedna funkce `toPublicContent` slouží živému náhledu,
 * náhledu konceptu i zveřejněnému snímku (`site_versions.public_content`), takže pár vidí
 * v průvodci přesně to, co potom uvidí hosté. Převod je shovívavý: nehotové položky (událost bez
 * času, místo bez adresy) se vynechají, kontrola kompletnosti je v `validateDraft`.
 */

const PLACEHOLDER_NAME: Record<Locale, string> = { cs: "Jméno", en: "Name" };

/** Neprázdné jazyky textu, nebo `null` (blok se pak nevykreslí). */
function text(value: I18nText | undefined): I18nText | null {
  if (!value) return null;
  const out: I18nText = {};
  for (const locale of ["cs", "en"] as const) {
    const part = value[locale]?.trim();
    if (part) out[locale] = part;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Text zadaný v jednom jazyce (název místa, jméno ubytování) patří do výchozího jazyka webu. */
function inDefault(value: string, locale: Locale): I18nText {
  return { [locale]: value.trim() } as I18nText;
}

/**
 * Výchozí názvy obřadu a hostiny jsou obsah webu (ne text rozhraní), proto nejsou v překladových
 * souborech a neprochází kontrolou rozhraní; zobrazí se v každém jazyce webu a pár je může
 * později přepsat. Typografii doplní `typo()` při vykreslení.
 */
export const DEFAULT_EVENT_TITLES: Record<"ceremony" | "reception", Record<Locale, string>> = {
  ceremony: { cs: "Svatební obřad", en: "Wedding ceremony" },
  reception: { cs: "Hostina", en: "Reception" },
};

function eventTitle(kind: "ceremony" | "reception", locales: readonly Locale[]): I18nText {
  const title: I18nText = {};
  for (const locale of locales) title[locale] = DEFAULT_EVENT_TITLES[kind][locale];
  return title;
}

export interface ContentOptions {
  /** Adresa webu; bez ní (náhled) se použije zástupná. */
  slug?: string;
  /** Doplní zástupné hodnoty pro prázdné koncepty (jména, datum), aby šel náhled vykreslit. */
  placeholders?: boolean;
  phase?: Phase;
  now?: Date;
}

/** Fáze koncepčního náhledu: potvrzení účasti otevřené, po svatbě poděkování (jako `app.phase`). */
export function previewPhase(draft: WizardDraft, now: Date = new Date()): Phase {
  return phaseFromDates(
    { startsOn: draft.startsOn, endsOn: draft.endsOn, deadline: draft.rsvp.deadline },
    now,
  );
}

interface Resolved {
  venues: PublicContent["venues"];
  events: PublicContent["events"];
}

function resolvePlaces(draft: WizardDraft, date: string): Resolved {
  const { defaultLocale, locales } = draft;
  const venues: PublicContent["venues"] = [];
  const events: PublicContent["events"] = [];

  const venueOf = (part: PlaceDraft, id: string): string | null => {
    const name = part.venueName.trim();
    const address = part.venueAddress.trim();
    if (name === "" || address === "") return null;
    venues.push({
      id,
      name: inDefault(name, defaultLocale),
      address,
      directions: text(part.directions),
      mapUrl: null,
    });
    return id;
  };

  let ceremonyVenue: string | null = null;
  if (draft.ceremony.enabled) {
    ceremonyVenue = venueOf(draft.ceremony, draft.ids.venueA);
    if (isTime(draft.ceremony.time)) {
      events.push({
        id: draft.ids.ceremony,
        kind: "ceremony",
        title: eventTitle("ceremony", locales),
        description: null,
        startsAt: zonedIso(date, draft.ceremony.time),
        endsAt: null,
        venueId: ceremonyVenue,
      });
    }
  }

  if (draft.reception.enabled) {
    const shares = draft.reception.sameVenue && draft.ceremony.enabled;
    const venueId = shares ? ceremonyVenue : venueOf(draft.reception, draft.ids.venueB);
    if (isTime(draft.reception.time)) {
      events.push({
        id: draft.ids.reception,
        kind: "reception",
        title: eventTitle("reception", locales),
        description: null,
        startsAt: zonedIso(date, draft.reception.time),
        endsAt: null,
        venueId,
      });
    }
  }

  for (const extra of draft.extraEvents) {
    const title = text(extra.title);
    if (!title || !isTime(extra.time)) continue;
    events.push({
      id: extra.id,
      kind: "other",
      title,
      description: null,
      startsAt: zonedIso(date, extra.time),
      endsAt: null,
      venueId: null,
    });
  }

  events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { venues, events };
}

function isTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

function buildBlocks(draft: WizardDraft, resolved: Resolved): Block[] {
  const blocks: Block[] = [];
  const base = { enabled: true, sensitive: false } as const;
  let position = 0;
  const next = () => ++position;
  const { defaultLocale } = draft;

  blocks.push({
    ...base,
    id: draft.ids.hero,
    type: "hero",
    anchor: "uvod",
    position: next(),
    data: { countdown: true, tagline: null },
  });

  if (resolved.events.length > 0) {
    blocks.push({
      ...base,
      id: draft.ids.program,
      type: "program",
      anchor: "program",
      position: next(),
      data: { intro: null },
    });
  }
  if (resolved.venues.length > 0) {
    blocks.push({
      ...base,
      id: draft.ids.venue,
      type: "venue",
      anchor: "misto",
      position: next(),
      data: { venueIds: resolved.venues.map((venue) => venue.id), intro: null },
    });
  }

  const items = draft.lodging
    .filter((item) => item.name.trim() !== "")
    .map((item) => ({
      id: item.id,
      name: inDefault(item.name, defaultLocale),
      description: text(item.description),
      url: normalizeUrl(item.url),
    }));
  const transport = text(draft.transport);
  if (items.length > 0 || transport) {
    blocks.push({
      ...base,
      id: draft.ids.lodging,
      type: "lodging",
      anchor: "ubytovani",
      position: next(),
      data: { items, transport },
    });
  }

  const dressCode = text(draft.dressCode);
  if (dressCode) {
    blocks.push({
      ...base,
      id: draft.ids.dresscode,
      type: "dresscode",
      anchor: "dresscode",
      position: next(),
      data: { text: dressCode },
    });
  }

  const people = draft.contacts
    .filter((contact) => contact.name.trim() !== "")
    .map((contact) => ({
      id: contact.id,
      name: contact.name.trim(),
      role: null,
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email.trim()) ? contact.email.trim() : null,
      phone: normalizePhone(contact.phone),
    }));
  if (people.length > 0) {
    blocks.push({
      ...base,
      id: draft.ids.contact,
      type: "contact",
      anchor: "kontakt",
      position: next(),
      data: { people },
    });
  }

  blocks.push({
    ...base,
    id: draft.ids.rsvp,
    type: "rsvp",
    anchor: "potvrdit-ucast",
    position: next(),
    data: { intro: null },
  });
  return blocks;
}

/**
 * Obsah webu z konceptu. Výsledek prochází `publicContentSchema`, takže zveřejnit nebo vykreslit
 * jde jen platný snímek; při chybě schématu vyhodí výjimku (chyba programu, ne uživatele).
 */
export function toPublicContent(draft: WizardDraft, options: ContentOptions = {}): PublicContent {
  const now = options.now ?? new Date();
  const placeholders = options.placeholders ?? false;
  const date =
    draft.startsOn !== ""
      ? draft.startsOn
      : placeholders
        ? addDays(todayIn(now), 180)
        : draft.startsOn;
  const resolved = resolvePlaces(draft, date);

  const content = {
    version: 1 as const,
    slug: options.slug ?? (draft.slug || "nahled"),
    partners: {
      a: draft.partnerA.trim() || (placeholders ? PLACEHOLDER_NAME[draft.defaultLocale] : ""),
      b: draft.partnerB.trim() || (placeholders ? PLACEHOLDER_NAME[draft.defaultLocale] : ""),
    },
    startsOn: date,
    endsOn: draft.endsOn !== "" && draft.endsOn >= date ? draft.endsOn : null,
    timezone: DEFAULT_TIMEZONE,
    locales: draft.locales,
    defaultLocale: draft.defaultLocale,
    template: draft.template,
    palette: draft.palette,
    phase: options.phase ?? "save_the_date",
    quickNotice: null,
    thanksMessage: null,
    venues: resolved.venues,
    events: resolved.events,
    media: [],
    blocks: buildBlocks(draft, resolved),
  };
  return publicContentSchema.parse(content);
}

/** Obsah za PINem hostů: průvodce žádný nemá (dary přijdou se správou, M7). */
export function toSensitiveContent(): SensitiveContent {
  return sensitiveContentSchema.parse({});
}

/** Pracovní sada pro `wizard_save` a `wizard_create_draft` (tvar viz `app.wizard_apply`). */
export interface WorkingSet {
  wedding: {
    partnerA: string;
    partnerB: string;
    startsOn: string;
    endsOn: string | null;
    timezone: string;
    locales: Locale[];
    defaultLocale: Locale;
    template: string;
    palette: string;
    guestPinEnabled: boolean;
  };
  venues: { id: string; name: I18nText; address: string; directions: I18nText | null }[];
  events: {
    id: string;
    kind: string;
    title: I18nText;
    description: I18nText | null;
    startsAt: string;
    endsAt: string | null;
    venueId: string | null;
    rsvpEnabled: boolean;
  }[];
  blocks: {
    id: string;
    type: string;
    anchor: string;
    enabled: boolean;
    position: number;
    sensitive: boolean;
    data: unknown;
  }[];
  rsvp: {
    opensAt: string | null;
    closesAt: string | null;
    allowUnlisted: boolean;
    emailConfirmation: boolean;
    questions: Record<string, boolean>;
  };
}

/** Pracovní tabulky zrcadlí zveřejnitelný obsah, proto se sada skládá z `toPublicContent`. */
export function toWorkingSet(draft: WizardDraft, now: Date = new Date()): WorkingSet {
  const content = toPublicContent(draft, { now });
  return {
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
      guestPinEnabled: draft.guestPin.enabled,
    },
    venues: content.venues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      address: venue.address,
      directions: venue.directions,
    })),
    events: content.events.map((event) => ({
      id: event.id,
      kind: event.kind,
      title: event.title,
      description: event.description,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      venueId: event.venueId,
      rsvpEnabled: event.kind !== "other",
    })),
    blocks: content.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      anchor: block.anchor,
      enabled: block.enabled,
      position: block.position,
      sensitive: block.sensitive,
      data: block.data,
    })),
    rsvp: {
      opensAt: null,
      closesAt: draft.rsvp.deadline !== "" ? endOfDayIso(draft.rsvp.deadline) : null,
      allowUnlisted: false,
      emailConfirmation: draft.rsvp.emailConfirmation,
      questions: {
        plus_one: draft.rsvp.plusOne,
        children: draft.rsvp.children,
        diet: draft.rsvp.diet,
      },
    },
  };
}
