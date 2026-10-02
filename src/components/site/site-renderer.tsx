import type { CSSProperties } from "react";
import { Info } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { locales, type Locale } from "@/i18n/config";
import { formatDateRange } from "@/site/format";
import { getPalette } from "@/site/themes/palettes";
import type { Block, PublicContent, SensitiveContent } from "@/site/types";
import { createSiteCtx, BLOCK_NAV, renderableBlocks, rsvpIsOpen, type SiteCtx } from "./context";
import { Contact } from "./blocks/contact";
import { Faq } from "./blocks/faq";
import { Gallery } from "./blocks/gallery";
import { Gifts } from "./blocks/gifts";
import { Hero } from "./blocks/hero";
import { DressCode, Lodging } from "./blocks/lodging";
import { Program } from "./blocks/program";
import { Rsvp } from "./blocks/rsvp";
import { Story } from "./blocks/story";
import { Venue } from "./blocks/venue";
import { SiteLanguageSwitch } from "./site-language-switch";
import "./site.css";

export interface SiteRendererProps {
  content: PublicContent;
  locale: Locale;
  /** Adresa téže stránky v jazycích webu (pro přepínač jazyka). */
  localeHrefs?: Partial<Record<Locale, string>>;
  /** Aktuální okamžik pro odpočet; testy ho předávají pevně. */
  now?: Date;
  /** Citlivé bloky (dary) se vykreslí jen s tímto příznakem (FR-PRIV-2). */
  sensitiveUnlocked?: boolean;
  /** Obsah citlivých bloků; bez příznaku `sensitiveUnlocked` se nepoužije. */
  sensitive?: SensitiveContent | null;
}

/** Barvy palety jako CSS proměnné `--s-*` (jediný způsob, jak šablona barvy dostane). */
function paletteStyle(content: PublicContent): CSSProperties {
  const palette = getPalette(content.template, content.palette);
  return Object.fromEntries(
    Object.entries(palette.colors).map(([role, value]) => [`--s-${role}`, value]),
  ) as CSSProperties;
}

function renderBlock(block: Block, ctx: SiteCtx, tone: "bg" | "surface") {
  switch (block.type) {
    case "hero":
      return <Hero key={block.id} block={block} ctx={ctx} />;
    case "program":
      return <Program key={block.id} block={block} ctx={ctx} tone={tone} />;
    case "venue":
      return <Venue key={block.id} block={block} ctx={ctx} tone={tone} />;
    case "lodging":
      return <Lodging key={block.id} block={block} ctx={ctx} tone={tone} />;
    case "dresscode":
      return <DressCode key={block.id} block={block} ctx={ctx} tone={tone} />;
    case "faq":
      return <Faq key={block.id} block={block} ctx={ctx} tone={tone} />;
    case "contact":
      return <Contact key={block.id} block={block} ctx={ctx} tone={tone} />;
    case "story":
      return <Story key={block.id} block={block} ctx={ctx} tone={tone} />;
    case "gifts":
      return <Gifts key={block.id} block={block} ctx={ctx} tone={tone} />;
    case "gallery":
      return <Gallery key={block.id} block={block} ctx={ctx} tone={tone} />;
    case "rsvp":
      return <Rsvp key={block.id} block={block} ctx={ctx} tone={tone} />;
  }
}

/**
 * Vykreslení webu páru: jedna dlouhá stránka s kotvami nad společnými bloky. Šablona mění jen
 * tokeny (`data-template` a barvy palety), typografii a kompozici v `site.css`. Serverová
 * komponenta bez klientského JavaScriptu (výjimkou je zástupný formulář PINu).
 */
export function SiteRenderer({
  content,
  locale,
  localeHrefs,
  now,
  sensitiveUnlocked = false,
  sensitive = null,
}: SiteRendererProps) {
  const ctx = createSiteCtx(content, locale, { now, sensitiveUnlocked, sensitive });
  const { t } = ctx;
  const blocks = renderableBlocks(ctx);
  const rsvpBlock = blocks.find((block) => block.type === "rsvp");
  const sticky = rsvpIsOpen(content) && rsvpBlock !== undefined;
  const notice = ctx.text(content.quickNotice);
  const hrefs = Object.fromEntries(
    locales.map((l) => [l, localeHrefs?.[l] ?? (l === "cs" ? "/" : `/${l}`)]),
  ) as Record<Locale, string>;
  const navBlocks = blocks.filter(
    (block): block is Exclude<Block, { type: "hero" }> => block.type !== "hero",
  );
  let index = 0;

  return (
    <div
      className="site-root"
      data-template={content.template}
      data-palette={getPalette(content.template, content.palette).key}
      data-sticky={sticky ? "true" : undefined}
      style={paletteStyle(content)}
    >
      {notice ? (
        <aside className="site-notice" aria-label={t("site.notice.label")}>
          <div className="site-wrap">
            <Icon icon={Info} />
            <p lang={ctx.lang(content.quickNotice)}>{notice}</p>
          </div>
        </aside>
      ) : null}

      <header className="site-header">
        <div className="site-wrap site-header-inner">
          <nav aria-label={t("site.nav.label")} className="site-nav">
            <ul>
              {navBlocks.map((block) => (
                <li key={block.id}>
                  <a href={`#${block.anchor}`} className="site-nav-link">
                    {t(BLOCK_NAV[block.type])}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <SiteLanguageSwitch locales={content.locales} current={locale} hrefs={hrefs} t={t} />
        </div>
      </header>

      <main id="obsah" tabIndex={-1} className="site-main">
        {blocks.map((block) => {
          if (block.type === "hero") return renderBlock(block, ctx, "bg");
          // Střídání podkladu `surface` a `bg` pod úvodem.
          const tone = index++ % 2 === 0 ? "surface" : "bg";
          return renderBlock(block, ctx, tone);
        })}
      </main>

      <footer className="site-footer">
        <div className="site-wrap">
          <p className="site-footer-names">
            {t("site.footer.names", { a: content.partners.a, b: content.partners.b })}
          </p>
          <p className="site-muted">
            <time dateTime={content.startsOn}>
              {formatDateRange(content.startsOn, content.endsOn, locale)}
            </time>
          </p>
        </div>
      </footer>

      {sticky && rsvpBlock ? (
        <aside className="site-sticky" aria-label={t("site.rsvp.stickyLabel")}>
          <a href={`#${rsvpBlock.anchor}`} className="site-btn site-btn-sticky">
            {t("site.rsvp.cta")}
          </a>
        </aside>
      ) : null}
    </div>
  );
}
