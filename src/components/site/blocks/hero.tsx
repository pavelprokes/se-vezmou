import { ArrowRight } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { formatDateRange } from "@/site/format";
import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { heroModel } from "../models";
import { Paragraphs } from "./section";

/**
 * Úvod: jména (jediný `h1`), pod nimi pruh „Kdy / Kde / Odpovězte do“ (datum se začátkem programu,
 * první místo a při otevřeném RSVP termín s odkazem na formulář) a volitelný odpočet. V režimu poděkování
 * po svatbě odpočet zmizí a místo „Budeme se brát“ se zobrazí poděkování (FR-WEB-4).
 */
export function Hero({ block, ctx }: { block: BlockOf<"hero">; ctx: SiteCtx }) {
  const { content, t, locale } = ctx;
  const { thanks, venue, days, showCountdown, start, reply } = heroModel(block, ctx);

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
        <dl className="site-hero-facts">
          <div className="site-hero-fact">
            <dt>{t("site.hero.when")}</dt>
            <dd>
              <time dateTime={content.startsOn} className="site-hero-fact-main">
                {formatDateRange(content.startsOn, content.endsOn, locale)}
              </time>
              {start ? (
                <span className="site-hero-fact-sub">{t("site.hero.from", { time: start })}</span>
              ) : null}
            </dd>
          </div>
          {venue ? (
            <div className="site-hero-fact">
              <dt>{t("site.hero.where")}</dt>
              <dd>
                <span className="site-hero-fact-main" lang={ctx.lang(venue.name)}>
                  {ctx.text(venue.name)}
                </span>
                {venue.address ? <span className="site-hero-fact-sub">{venue.address}</span> : null}
              </dd>
            </div>
          ) : null}
          {reply ? (
            <div className="site-hero-fact">
              <dt>{reply.closes ? t("site.hero.replyBy") : t("site.hero.reply")}</dt>
              <dd>
                {reply.closes ? <span className="site-hero-fact-main">{reply.closes}</span> : null}
                <a href={`#${reply.anchor}`} className="site-hero-fact-link">
                  {t("site.rsvp.cta")}
                  <Icon icon={ArrowRight} size={18} />
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
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
