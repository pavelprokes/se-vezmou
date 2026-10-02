import { MapPin } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { daysUntil, formatDateRange } from "@/site/format";
import type { BlockOf } from "@/site/types";
import { EucalyptusLeaves, Monogram } from "../ornaments";
import type { SiteCtx } from "../context";
import { Paragraphs } from "./section";

/**
 * Úvod: jména (jediný `h1`), datum, místo a volitelný odpočet. V režimu poděkování po svatbě
 * odpočet zmizí a místo „Budeme se brát“ se zobrazí poděkování (FR-WEB-4).
 */
export function Hero({ block, ctx }: { block: BlockOf<"hero">; ctx: SiteCtx }) {
  const { content, t, locale } = ctx;
  const thanks = content.phase === "thanks";
  const venue = content.venues[0];
  const days = daysUntil(content.startsOn, content.timezone, ctx.now);
  const showCountdown = block.data.countdown && !thanks && days >= 0;
  const template = content.template;

  return (
    <section id={block.anchor} aria-labelledby="site-jmena" className="site-hero">
      {template === "eukalyptus" ? <EucalyptusLeaves /> : null}
      <div className="site-wrap site-hero-inner">
        {template === "chateau" ? <Monogram a={content.partners.a} b={content.partners.b} /> : null}
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
