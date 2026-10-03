import { localePath, locales, type Locale } from "@/i18n/config";
import { dayInZone, daysUntil, formatDay, formatTime } from "@/site/format";
import type { MapPoint } from "@/site/map/view";
import type { Block, BlockOf, PublicEvent, PublicMedia, PublicVenue } from "@/site/types";
import { renderableBlocks, rsvpIsOpen, type SiteCtx } from "./context";

/**
 * Modely bloků: co se z obsahu webu zobrazí, bez rozhodnutí, JAK to vypadá. Sdílí je všechny šablony,
 * takže pravidla (fáze, PIN, soukromá místa, chráněné fotografie) jsou na jednom místě a šablona řeší
 * jen kompozici. Čisté funkce bez JSX (vykreslují se na serveru i v živém náhledu v prohlížeči).
 */

export type ContentBlock = Exclude<Block, { type: "hero" }>;

/** Kostra stránky: bloky k vykreslení, navigace, ukotvené tlačítko RSVP a pruh rychlé změny. */
export interface SiteLayout {
  blocks: Block[];
  hero: BlockOf<"hero">;
  /** Bloky pod úvodem (cíle navigace). */
  sections: ContentBlock[];
  rsvpBlock: BlockOf<"rsvp"> | undefined;
  /** Ukotvené tlačítko „Potvrdit účast“ (jen při otevřeném RSVP). */
  sticky: boolean;
  /** Text pruhu rychlé změny (prázdný = bez pruhu). */
  notice: string;
  /** Adresa téže stránky v jazycích webu (přepínač jazyka). */
  hrefs: Record<Locale, string>;
}

export function siteLayout(
  ctx: SiteCtx,
  localeHrefs?: Partial<Record<Locale, string>>,
): SiteLayout {
  const blocks = renderableBlocks(ctx);
  const hero = blocks[0] as BlockOf<"hero">;
  const sections = blocks.filter((block): block is ContentBlock => block.type !== "hero");
  const rsvpBlock = sections.find((block): block is BlockOf<"rsvp"> => block.type === "rsvp");
  return {
    blocks,
    hero,
    sections,
    rsvpBlock,
    sticky: rsvpIsOpen(ctx.content) && rsvpBlock !== undefined,
    notice: ctx.text(ctx.content.quickNotice),
    hrefs: Object.fromEntries(
      locales.map((l) => [l, localeHrefs?.[l] ?? localePath("/", l)]),
    ) as Record<Locale, string>,
  };
}

/** Úvod: poděkování po svatbě, první místo konání a odpočet. */
export function heroModel(block: BlockOf<"hero">, ctx: SiteCtx) {
  const { content } = ctx;
  const thanks = content.phase === "thanks";
  const days = daysUntil(content.startsOn, content.timezone, ctx.now);
  return {
    thanks,
    venue: content.venues[0] as PublicVenue | undefined,
    days,
    showCountdown: block.data.countdown && !thanks && days >= 0,
  };
}

export interface ProgramEntry {
  event: PublicEvent;
  venue: PublicVenue | undefined;
  start: string;
  end: string | null;
}

/** Program po dnech v časovém pásmu svatby (vícedenní svatba má víc dní). */
export function programDays(ctx: SiteCtx) {
  const { content, locale } = ctx;
  const sorted = [...content.events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const days = new Map<string, ProgramEntry[]>();
  for (const event of sorted) {
    const day = dayInZone(event.startsAt, content.timezone);
    days.set(day, [
      ...(days.get(day) ?? []),
      {
        event,
        venue: ctx.venue(event.venueId),
        start: formatTime(event.startsAt, locale, content.timezone),
        end: event.endsAt ? formatTime(event.endsAt, locale, content.timezone) : null,
      },
    ]);
  }
  return {
    multiDay: days.size > 1,
    days: [...days.entries()].map(([day, entries]) => ({
      day,
      label: formatDay(day, locale),
      entries,
    })),
  };
}

export interface VenueEntry {
  venue: PublicVenue;
  /** Adresa (u soukromého místa jen po PINu, jinak `null`). */
  address: string | null;
  mapUrl: string | null;
  directions: PublicVenue["directions"];
  /** Soukromé místo bez odemčené adresy: místo adresy formulář PINu. */
  locked: boolean;
  /** Souřadnice pro mapu a odkazy do map (jen veřejná místa s volbou `showMap`). */
  point: { lat: number; lng: number } | null;
}

/**
 * Místa konání bloku. Soukromé místo má adresu jen po PINu (FR-PRIV-2) a nikdy není na mapě ani v odkazech.
 */
export function venueEntries(block: BlockOf<"venue">, ctx: SiteCtx) {
  const venues = block.data.venueIds.map((id) => ctx.venue(id)).filter((v) => v !== undefined);
  const entries: VenueEntry[] = venues.map((venue) => {
    const unlocked =
      venue.isPrivate && ctx.sensitiveUnlocked ? (ctx.sensitive?.venues[venue.id] ?? null) : null;
    const address = venue.isPrivate ? (unlocked?.address ?? null) : venue.address;
    return {
      venue,
      address,
      mapUrl: venue.isPrivate ? (unlocked?.mapUrl ?? null) : venue.mapUrl,
      directions: venue.isPrivate ? (unlocked?.directions ?? null) : venue.directions,
      locked: venue.isPrivate && !address,
      point:
        block.data.showMap && !venue.isPrivate && venue.lat !== null && venue.lng !== null
          ? { lat: venue.lat, lng: venue.lng }
          : null,
    };
  });
  const points: MapPoint[] = entries.flatMap((entry) =>
    entry.point ? [{ ...entry.point, label: ctx.text(entry.venue.name) }] : [],
  );
  return { entries, points };
}

/** Fotografie s popiskem pro galerii a prohlížeč (bez popisku a nedekorativní se nevykreslí, WCAG 1.1.1). */
export interface GalleryItem {
  media: PublicMedia;
  alt: string;
  lang: string | undefined;
}

/**
 * Galerie: vlastní fotografie a odkaz na externí galerii, obojí volitelně za PINem. Chráněné údaje
 * jsou v modelu jen po odemčení; `locked` znamená zobrazit výzvu k zadání PINu.
 */
export function galleryModel(block: BlockOf<"gallery">, ctx: SiteCtx) {
  const { t } = ctx;
  const link = block.data.link;
  const photosProtected = block.data.photosProtected;
  const linkProtected = link?.protected === true;

  const url = link
    ? linkProtected
      ? ctx.sensitiveUnlocked
        ? (ctx.sensitive?.gallery?.url ?? null)
        : null
      : link.url
    : null;
  // Karta: název (text odkazu od páru přepisuje název z cílové stránky), popis, doména a kopie obrázku.
  const card = link ? (linkProtected ? (ctx.sensitive?.gallery?.card ?? null) : link.card) : null;
  const fetched = card?.status === "ok" ? card : null;
  const cardImage: PublicMedia | undefined = fetched?.imageMediaId
    ? ctx.media(fetched.imageMediaId)
    : undefined;

  // Fotografie v pořadí: veřejné podle `mediaIds`, chráněné z citlivé části (bez obrázku karty).
  const media: PublicMedia[] = photosProtected
    ? ctx.sensitiveUnlocked
      ? (ctx.sensitive?.photos ?? []).filter((m) => m.id !== fetched?.imageMediaId)
      : []
    : block.data.mediaIds.map((id) => ctx.media(id)).filter((m) => m !== undefined);
  const items: GalleryItem[] = media
    .map((m) => ({ media: m, alt: ctx.text(m.alt), lang: ctx.lang(m.alt) }))
    .filter(({ media: m, alt }) => m.decorative || alt !== "");

  const ownTitle = link ? ctx.text(link.label) : "";
  let host = "";
  try {
    host = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }
  const gated = photosProtected || linkProtected;
  return {
    url,
    title: ownTitle || fetched?.title || t("site.gallery.linkDefault"),
    titleLang: ownTitle && link ? ctx.lang(link.label) : undefined,
    description: fetched?.description ?? null,
    host,
    cardImage,
    items,
    photosProtected,
    linkProtected,
    gated,
    // Příznak odemčení bez citlivých údajů nic neodemkne (zůstane výzva k zadání PINu)
    locked: gated && !(ctx.sensitiveUnlocked && ctx.sensitive !== null),
  };
}

/** Potvrzení účasti: otevřené jen ve fázi `rsvp_open`; konec potvrzování jako den svatby. */
export function rsvpModel(ctx: SiteCtx) {
  const { content } = ctx;
  const closesAt = ctx.rsvp?.closesAt ?? null;
  return {
    open: rsvpIsOpen(content),
    closes: closesAt ? formatDay(dayInZone(closesAt, content.timezone), ctx.locale) : null,
    status:
      content.phase === "save_the_date" ? ctx.t("site.rsvp.notYet") : ctx.t("site.rsvp.closed"),
  };
}

/** Obrázek příběhu, jen pokud má popisek nebo je dekorativní. */
export function storyImage(block: BlockOf<"story">, ctx: SiteCtx) {
  const media = ctx.media(block.data.mediaId);
  const alt = media ? ctx.text(media.alt) : "";
  return media && (media.decorative || alt !== "")
    ? { media, alt, lang: ctx.lang(media.alt) }
    : null;
}

/** Položky FAQ s otázkou i odpovědí. */
export function faqItems(block: BlockOf<"faq">, ctx: SiteCtx) {
  return block.data.items.filter((i) => ctx.text(i.question) && ctx.text(i.answer));
}

/** Dary po odemčení PINem (jinak `null` a výzva k PINu). */
export function giftsModel(ctx: SiteCtx) {
  return ctx.sensitiveUnlocked ? (ctx.sensitive?.gifts ?? null) : null;
}
