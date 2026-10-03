import { MapPin } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { formatDateRange } from "@/site/format";
import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { heroModel } from "../models";
import { Paragraphs } from "./section";

/**
 * Úvod: jména (jediný `h1`), datum, místo a volitelný odpočet. V režimu poděkování po svatbě
 * odpočet zmizí a místo „Budeme se brát“ se zobrazí poděkování (FR-WEB-4).
 */
export function Hero({ block, ctx }: { block: BlockOf<"hero">; ctx: SiteCtx }) {
  const { content, t, locale } = ctx;
  const { thanks, venue, days, showCountdown } = heroModel(block, ctx);

  return (
    <section id={block.anchor} aria-labelledby="site-jmena" className="site-hero">
      {ctx.decor.heroBackdrop}
      <div className="site-wrap site-hero-inner">
        {ctx.decor.heroCrest}
        <p className="site-eyebrow">
          {thanks ? t("site.thanks.title") : t("site.hero.saveTheDate")}
        </p>
        <h1 id="site-jmena" className="site-names">
          <span>{content.partners.a}</span> <span className="site-amp">&amp;</span>{" "}
          <span>{content.partners.b}</span>
        </h1>
        <p className="site-date">
          <time dateTime={content.startsOn}>
            {formatDateRange(content.startsOn, content.endsOn, locale)}
          </time>
        </p>
        {venue ? (
          <p className="site-place">
            <Icon icon={MapPin} />
            <span lang={ctx.lang(venue.name)}>{ctx.text(venue.name)}</span>
          </p>
        ) : null}
        {showCountdown ? (
          <p className="site-countdown">
            {days === 0 ? t("site.hero.today") : t("site.hero.countdown", { count: days })}
          </p>
        ) : null}
        {thanks ? (
          ctx.text(content.thanksMessage) ? (
            <Paragraphs value={content.thanksMessage} ctx={ctx} className="site-lead" />
          ) : (
            <p className="site-lead">{t("site.thanks.body")}</p>
          )
        ) : (
          <Paragraphs value={block.data.tagline} ctx={ctx} className="site-lead" />
        )}
      </div>
    </section>
  );
}
