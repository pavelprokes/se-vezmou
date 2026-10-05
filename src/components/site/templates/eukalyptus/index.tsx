import type { CSSProperties } from "react";
import {
  getPalette,
  surfaceKeys,
  templates,
  type Palette,
  type SurfaceKey,
} from "@/site/themes/palettes";
import type { SiteCtx } from "../../context";
import { heroModel, type ContentBlock } from "../../models";
import { paletteStyle } from "../../palette-style";
import { SiteLanguageSwitch } from "../../site-language-switch";
import type { TemplateProps } from "../classic";
import {
  EuContact,
  EuCountdown,
  EuDressCode,
  EuFaq,
  EuFooter,
  EuGifts,
  EuHero,
  EuLodging,
  EuPhotos,
  EuProgram,
  EuRsvp,
  EuStory,
  EuVenues,
  navLabel,
} from "./blocks";
import { EuNav, EuNoticeBar, EuStickyCta } from "./client";
import { assignTones, roman, type EuPart } from "./layout";
import "../../site.css";
import "./eukalyptus.css";

/** Plochy palety jako CSS proměnné `--eu-<plocha>-<role>`; paleta bez ploch padne na výchozí Bordó. */
function surfaceStyle(palette: Palette): CSSProperties {
  const surfaces =
    palette.surfaces ?? getPalette("eukalyptus", templates.eukalyptus.defaultPalette).surfaces!;
  const vars: Record<string, string> = {
    "--eu-field": surfaces.field,
    "--eu-ink": surfaces.ink,
  };
  for (const key of surfaceKeys) {
    for (const [role, value] of Object.entries(surfaces.tones[key])) {
      vars[`--eu-${key}-${role}`] = value;
    }
  }
  return vars as CSSProperties;
}

function renderSection(block: ContentBlock, ctx: SiteCtx, tone: SurfaceKey, index: string) {
  const props = { ctx, tone, index };
  switch (block.type) {
    case "program":
      return <EuProgram key={block.id} block={block} {...props} />;
    case "venue":
      return <EuVenues key={block.id} block={block} {...props} />;
    case "lodging":
      return <EuLodging key={block.id} block={block} {...props} />;
    case "dresscode":
      return <EuDressCode key={block.id} block={block} {...props} />;
    case "faq":
      return <EuFaq key={block.id} block={block} {...props} />;
    case "contact":
      return <EuContact key={block.id} block={block} {...props} />;
    case "story":
      return <EuStory key={block.id} block={block} {...props} />;
    case "gifts":
      return <EuGifts key={block.id} block={block} {...props} />;
    case "gallery":
      return <EuPhotos key={block.id} block={block} {...props} />;
    case "rsvp":
      return <EuRsvp key={block.id} block={block} {...props} />;
  }
}

/** Iniciály páru pro monogram v navigaci. */
function initials(a: string, b: string): string {
  return `${a.trim().charAt(0)}${b.trim().charAt(0)}`.toUpperCase();
}

/**
 * Eukalyptus 2.0: editoriální šablona s obří typografií, plnými barevnými plochami a jiným rozvržením
 * každé sekce (docs: zadání „Eukalyptus 2.0“). Plochy se střídají podle `assignTones` (žádné dvě sousední
 * stejné), sekce se číslují římsky podle vykreslených bloků. Po svatbě (fáze `thanks`) jsou fotografie hned
 * za úvodem a odpočet zmizí (RSVP a dary už vyřadil `renderableBlocks`).
 */
export function EukalyptusSite({ ctx, layout }: TemplateProps) {
  const { content, t, locale } = ctx;
  const palette = getPalette(content.template, content.palette);
  const { hero, rsvpBlock, sticky, notice, hrefs } = layout;
  const { thanks, days, showCountdown } = heroModel(hero, ctx);

  const sections: ContentBlock[] = thanks
    ? [
        ...layout.sections.filter((b) => b.type === "gallery"),
        ...layout.sections.filter((b) => b.type !== "gallery"),
      ]
    : layout.sections;
  const parts: EuPart[] = [
    "hero",
    ...(showCountdown ? (["countdown"] as const) : []),
    ...sections.map((b) => b.type),
    "footer",
  ];
  const tones = assignTones(parts);
  const toneOf = (offset: number) => tones[offset];
  const sectionOffset = showCountdown ? 2 : 1;
  const navItems = sections.map((block) => ({ anchor: block.anchor, label: navLabel(block, ctx) }));
  const heroPhoto = ctx.media(hero.data.photoMediaId);

  return (
    <div
      className="site-root eu"
      data-template="eukalyptus"
      data-palette={palette.key}
      data-sticky={sticky ? "true" : undefined}
      style={{ ...paletteStyle(content), ...surfaceStyle(palette) }}
    >
      {notice ? (
        <EuNoticeBar
          text={notice}
          lang={ctx.lang(content.quickNotice)}
          label={t("site.notice.label")}
          closeLabel={t("site.notice.close")}
        />
      ) : null}
      <EuNav
        items={navItems}
        label={t("site.nav.label")}
        monogram={initials(content.partners.a, content.partners.b)}
        topLabel={t("site.nav.top")}
        onPhoto={heroPhoto !== undefined}
      >
        <SiteLanguageSwitch locales={content.locales} current={locale} hrefs={hrefs} t={t} />
      </EuNav>

      <main id="obsah" tabIndex={-1} className="eu-main">
        <EuHero block={hero} ctx={ctx} next={navItems[0]?.anchor ?? null} />
        {showCountdown ? <EuCountdown ctx={ctx} days={days} tone={toneOf(1)} /> : null}
        {sections.map((block, i) => {
          // Dary číslo nemají (nadpis je ve věnci), proto se do číslování nepočítají.
          const number = sections.slice(0, i + 1).filter((b) => b.type !== "gifts").length;
          return renderSection(block, ctx, toneOf(sectionOffset + i), roman(number));
        })}
      </main>

      <EuFooter ctx={ctx} tone={toneOf(tones.length - 1)} />

      {sticky && rsvpBlock ? (
        <EuStickyCta
          target={rsvpBlock.anchor}
          label={t("site.rsvp.cta")}
          regionLabel={t("site.rsvp.stickyLabel")}
        />
      ) : null}
    </div>
  );
}
