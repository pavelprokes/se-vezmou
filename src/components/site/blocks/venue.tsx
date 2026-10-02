import { ExternalLink, MapPin } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { Paragraphs, Section } from "./section";

/**
 * Místo konání: textová adresa je vždy, mapa je jen doplněk v podobě odkazu.
 * Web nevkládá žádnou mapu ani skripty třetích stran (soukromí hostů).
 */
export function Venue({
  block,
  ctx,
  tone,
}: {
  block: BlockOf<"venue">;
  ctx: SiteCtx;
  tone: "bg" | "surface";
}) {
  const { t } = ctx;
  const venues = block.data.venueIds.map((id) => ctx.venue(id)).filter((v) => v !== undefined);

  return (
    <Section block={block} ctx={ctx} tone={tone}>
      <Paragraphs value={block.data.intro} ctx={ctx} className="site-lead" />
      <div className="site-cards">
        {venues.map((venue) => (
          <article key={venue.id} className="site-card" aria-labelledby={`venue-${venue.id}`}>
            <h3 id={`venue-${venue.id}`} className="site-h3">
              <span lang={ctx.lang(venue.name)}>{ctx.text(venue.name)}</span>
            </h3>
            <div className="site-address">
              <Icon icon={MapPin} label={t("site.venue.address")} />
              <address>{venue.address}</address>
            </div>
            {venue.directions ? (
              <>
                <p className="site-label">{t("site.venue.directions")}</p>
                <Paragraphs value={venue.directions} ctx={ctx} />
              </>
            ) : null}
            {venue.mapUrl ? (
              <p>
                <a href={venue.mapUrl} rel="noopener noreferrer" className="site-link">
                  {t("site.venue.map")}
                  <Icon icon={ExternalLink} size={16} />
                </a>{" "}
                <span className="site-muted site-hint">{t("site.venue.mapHint")}</span>
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </Section>
  );
}
