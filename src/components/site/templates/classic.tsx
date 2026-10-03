import { Info } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { formatDateRange } from "@/site/format";
import { getPalette } from "@/site/themes/palettes";
import type { Block } from "@/site/types";
import { BLOCK_NAV, type SiteCtx, type SiteDecor } from "../context";
import { Contact } from "../blocks/contact";
import { Faq } from "../blocks/faq";
import { Gallery } from "../blocks/gallery";
import { Gifts } from "../blocks/gifts";
import { Hero } from "../blocks/hero";
import { DressCode, Lodging } from "../blocks/lodging";
import { Program } from "../blocks/program";
import { Rsvp } from "../blocks/rsvp";
import { Story } from "../blocks/story";
import { Venue } from "../blocks/venue";
import type { SiteLayout } from "../models";
import { paletteStyle } from "../palette-style";
import { SiteLanguageSwitch } from "../site-language-switch";
import "../site.css";

export interface TemplateProps {
  ctx: SiteCtx;
  layout: SiteLayout;
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
 * Klasická kostra webu (Editorial, Chateau, Modern): jedna dlouhá stránka s kotvami nad sdílenými bloky
 * (`../blocks`), střídání podkladu `surface` a `bg`. Šablona do ní dodá jen dekor (`decor`); typografii
 * a kompozici mění `site.css` podle `data-template`. Serverová komponenta bez klientského JavaScriptu
 * (výjimkou jsou formuláře PINu a RSVP).
 */
export function ClassicSite({ ctx: base, layout, decor }: TemplateProps & { decor: SiteDecor }) {
  const ctx: SiteCtx = { ...base, decor };
  const { content, t, locale } = ctx;
  const { blocks, sections, rsvpBlock, sticky, notice, hrefs } = layout;
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
              {sections.map((block) => (
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
