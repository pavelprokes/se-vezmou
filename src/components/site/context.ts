import type { ReactNode } from "react";
import { htmlLang, type Locale } from "@/i18n/config";
import type { NamespaceKey } from "@/i18n/messages";
import type { Translator } from "@/i18n/translator";
import { typo } from "@/i18n/typo";
import type { RsvpSiteState } from "@/lib/rsvp/form";
import { pick, resolvedLocale, type I18nText } from "@/site/i18n-text";
import type {
  Block,
  BlockOf,
  BlockType,
  PublicContent,
  PublicMedia,
  PublicVenue,
  SensitiveContent,
} from "@/site/types";

/**
 * Jmenné prostory webu páru: jediné, které web páru (i živý náhled v prohlížeči) načítá. Zprávy
 * předává volající jako hotový `t` (`getTranslator(locale, SITE_NAMESPACES)` na serveru).
 */
export const SITE_NAMESPACES = ["common", "site", "rsvp"] as const;
export type SiteNamespace = (typeof SITE_NAMESPACES)[number];
export type SiteTranslator = Translator<SiteNamespace>;
type SiteKey = NamespaceKey<SiteNamespace>;

/** Vše, co bloky potřebují k vykreslení jednoho webu v jednom jazyce. */
export interface SiteCtx {
  content: PublicContent;
  locale: Locale;
  t: SiteTranslator;
  now: Date;
  sensitiveUnlocked: boolean;
  sensitive: SensitiveContent | null;
  /** Živý stav RSVP z databáze (počáteční stav formuláře, volby páru); bez něj formulář začíná jménem. */
  rsvp: RsvpSiteState | null;
  /** Text po jazycích s náhradním jazykem a typografií; bez textu prázdný řetězec. */
  text(value: I18nText | null | undefined): string;
  /** Odstavce oddělené prázdným řádkem. */
  paragraphs(value: I18nText | null | undefined): string[];
  /** `lang` pro prvek, jehož text se zobrazil v jiném jazyce, než je jazyk stránky (WCAG 3.1.2). */
  lang(value: I18nText | null | undefined): string | undefined;
  media(id: string | null | undefined): PublicMedia | undefined;
  venue(id: string | null | undefined): PublicVenue | undefined;
  /** Dekor šablony pro sdílené bloky (ornament v úvodu, oddělovač pod nadpisem sekce). */
  decor: SiteDecor;
}

/** Dekorativní prvky, které šablona vloží do sdílených bloků; vždy `aria-hidden`. */
export interface SiteDecor {
  /** Za obsahem úvodu (např. větvičky v rozích). */
  heroBackdrop?: ReactNode;
  /** Nad jmény v úvodu (např. monogram). */
  heroCrest?: ReactNode;
  /** Pod nadpisem každé sekce. */
  divider?: ReactNode;
}

export interface SiteCtxOptions {
  now?: Date;
  sensitiveUnlocked?: boolean;
  sensitive?: SensitiveContent | null;
  rsvp?: RsvpSiteState | null;
}

export function createSiteCtx(
  content: PublicContent,
  t: SiteTranslator,
  options: SiteCtxOptions = {},
): SiteCtx {
  const locale: Locale = t.locale;
  const fallback = content.defaultLocale;
  const text = (value: I18nText | null | undefined) =>
    typo(pick(value, locale, fallback), resolvedLocale(value, locale, fallback) ?? locale);
  return {
    content,
    locale,
    t,
    now: options.now ?? new Date(),
    sensitiveUnlocked: options.sensitiveUnlocked ?? false,
    sensitive: options.sensitive ?? null,
    rsvp: options.rsvp ?? null,
    text,
    paragraphs: (value) =>
      text(value)
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean),
    lang(value) {
      const shown = resolvedLocale(value, locale, fallback);
      return shown && shown !== locale ? htmlLang[shown] : undefined;
    },
    // Fotografie chráněné PINem hostů jsou jen v citlivé části snímku a jen po odemčení.
    media: (id) =>
      content.media.find((m) => m.id === id) ??
      (options.sensitiveUnlocked ? options.sensitive?.photos.find((m) => m.id === id) : undefined),
    venue: (id) => content.venues.find((v) => v.id === id),
    decor: {},
  };
}

/** Bloky, které režim poděkování po svatbě skrývá (FR-WEB-4): potvrzení účasti a dary. */
const HIDDEN_AFTER_WEDDING: readonly BlockType[] = ["rsvp", "gifts"];

/** Titulky a odkazy navigace podle typu bloku (literály kvůli kontrole překladů). */
export const BLOCK_TITLE: Record<Exclude<BlockType, "hero">, SiteKey> = {
  program: "site.program.title",
  venue: "site.venue.title",
  lodging: "site.lodging.title",
  dresscode: "site.dresscode.title",
  faq: "site.faq.title",
  contact: "site.contact.title",
  story: "site.story.title",
  gifts: "site.gifts.title",
  gallery: "site.gallery.title",
  rsvp: "site.rsvp.title",
};

export const BLOCK_NAV: Record<Exclude<BlockType, "hero">, SiteKey> = {
  program: "site.nav.program",
  venue: "site.nav.venue",
  lodging: "site.nav.lodging",
  dresscode: "site.nav.dresscode",
  faq: "site.nav.faq",
  contact: "site.nav.contact",
  story: "site.nav.story",
  gifts: "site.nav.gifts",
  gallery: "site.nav.gallery",
  rsvp: "site.nav.rsvp",
};

function hasContent(block: Block, ctx: SiteCtx): boolean {
  const { content } = ctx;
  switch (block.type) {
    case "hero":
    case "rsvp":
      return true;
    case "gifts":
      return block.data.payment || ctx.text(block.data.intro) !== "";
    case "program":
      return content.events.length > 0;
    case "venue":
      return block.data.venueIds.some((id) => ctx.venue(id));
    case "lodging":
      return block.data.items.length > 0 || ctx.text(block.data.transport) !== "";
    case "dresscode":
      return ctx.text(block.data.text) !== "";
    case "faq":
      return block.data.items.some((i) => ctx.text(i.question) && ctx.text(i.answer));
    case "contact":
      return block.data.people.length > 0;
    case "story":
      return ctx.text(block.data.text) !== "";
    case "gallery":
      return (
        block.data.link !== null ||
        // Fotografie chráněné PINem: blok se zobrazí i zamčený (s výzvou k zadání PINu)
        block.data.photosProtected ||
        block.data.mediaIds.some((id) => {
          const media = ctx.media(id);
          return media && (media.decorative || ctx.text(media.alt) !== "");
        })
      );
  }
}

/**
 * Bloky k vykreslení v pořadí `position`: jen zapnuté a neprázdné, po svatbě bez potvrzení účasti
 * a darů. Prázdný blok se nevykreslí, takže v navigaci nevznikne odkaz na nic.
 */
export function renderableBlocks(ctx: SiteCtx): Block[] {
  const thanks = ctx.content.phase === "thanks";
  const blocks = ctx.content.blocks
    .filter((block) => block.enabled)
    .filter((block) => !(thanks && HIDDEN_AFTER_WEDDING.includes(block.type)))
    .filter((block) => hasContent(block, ctx))
    .sort((a, b) => a.position - b.position);
  // Jména jako jediný `h1` jsou na stránce vždy a nahoře, i kdyby pár úvod vypnul.
  const hero = blocks.find((block) => block.type === "hero") ?? DEFAULT_HERO;
  return [hero, ...blocks.filter((block) => block.type !== "hero")];
}

const DEFAULT_HERO: BlockOf<"hero"> = {
  id: "hero",
  type: "hero",
  anchor: "uvod",
  enabled: true,
  position: 0,
  sensitive: false,
  data: { countdown: false, tagline: null, photoMediaId: null },
};

/** Přijímání potvrzení účasti je otevřené jen ve fázi `rsvp_open`. */
export function rsvpIsOpen(content: PublicContent): boolean {
  return content.phase === "rsvp_open";
}
