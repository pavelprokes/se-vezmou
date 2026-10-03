import { ExternalLink, Lock, MapPin } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { googleMapsUrl, mapyCzUrl } from "@/site/map/view";
import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { PinGate, UnlockedRegion } from "../pin-gate";
import { pinGateLabels } from "../pin-labels";
import { VenueMap } from "../venue-map";
import { Paragraphs, Section } from "./section";

/**
 * Místo konání: textová adresa je vždy, mapa je jen doplněk. S volbou `showMap` je pod místy statická
 * mapa z dlaždic OpenStreetMap načítaných přes vlastní původ a u míst odkazy do Google Maps a Mapy.cz.
 * Web nevkládá žádnou cizí mapu ani skripty třetích stran, prohlížeč hosta nekontaktuje nikoho dalšího
 * (soukromí hostů). Soukromé místo na mapě nikdy není a nemá ani odkazy.
 * Soukromé místo (`isPrivate`) má adresu za PINem hostů (FR-PRIV-2): bez PINu je vidět jen název
 * a formulář PINu, adresa se do HTML ani do RSC payloadu vůbec nedostane.
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
  const privateAddress = (id: string) =>
    ctx.sensitiveUnlocked ? (ctx.sensitive?.venues[id] ?? null) : null;
  const located = (venue: (typeof venues)[number]) =>
    block.data.showMap && !venue.isPrivate && venue.lat !== null && venue.lng !== null
      ? { lat: venue.lat, lng: venue.lng }
      : null;
  const points = venues.flatMap((venue) => {
    const point = located(venue);
    return point ? [{ ...point, label: ctx.text(venue.name) }] : [];
  });

  return (
    <Section
      block={block}
      ctx={ctx}
      tone={tone}
      after={points.length > 0 ? <VenueMap points={points} ctx={ctx} /> : null}
    >
      <Paragraphs value={block.data.intro} ctx={ctx} className="site-lead" />
      <div className="site-cards">
        {venues.map((venue) => {
          const unlocked = venue.isPrivate ? privateAddress(venue.id) : null;
          const address = venue.isPrivate ? (unlocked?.address ?? null) : venue.address;
          const mapUrl = venue.isPrivate ? (unlocked?.mapUrl ?? null) : venue.mapUrl;
          const directions = venue.isPrivate ? (unlocked?.directions ?? null) : venue.directions;
          const point = located(venue);
          return (
            <article key={venue.id} className="site-card" aria-labelledby={`venue-${venue.id}`}>
              <h3 id={`venue-${venue.id}`} className="site-h3">
                <span lang={ctx.lang(venue.name)}>{ctx.text(venue.name)}</span>
              </h3>
              {venue.isPrivate && !address ? (
                <div className="site-gate">
                  <Icon icon={Lock} size={24} />
                  <PinGate
                    labels={pinGateLabels(t, "venue")}
                    locale={ctx.locale}
                    unlockKey={`venue:${venue.id}`}
                    headingLevel={4}
                  />
                </div>
              ) : address ? (
                <div className="site-address">
                  <Icon icon={MapPin} label={t("site.venue.address")} />
                  {venue.isPrivate ? (
                    <UnlockedRegion label={t("site.pin.unlocked")} unlockKey={`venue:${venue.id}`}>
                      <address>{address}</address>
                    </UnlockedRegion>
                  ) : (
                    <address>{address}</address>
                  )}
                </div>
              ) : null}
              {directions ? (
                <>
                  <p className="site-label">{t("site.venue.directions")}</p>
                  <Paragraphs value={directions} ctx={ctx} />
                </>
              ) : null}
              {mapUrl ? (
                <p>
                  <a href={mapUrl} rel="noopener noreferrer" className="site-link">
                    {t("site.venue.map")}
                    <Icon icon={ExternalLink} size={16} />
                  </a>{" "}
                  <span className="site-muted site-hint">{t("site.venue.mapHint")}</span>
                </p>
              ) : null}
              {point ? (
                <p className="site-map-links">
                  <a
                    href={googleMapsUrl(point.lat, point.lng)}
                    rel="noopener noreferrer"
                    className="site-link"
                  >
                    {t("site.venue.googleMaps")}
                    <Icon icon={ExternalLink} size={16} />
                  </a>
                  <a
                    href={mapyCzUrl(point.lat, point.lng)}
                    rel="noopener noreferrer"
                    className="site-link"
                  >
                    {t("site.venue.mapyCz")}
                    <Icon icon={ExternalLink} size={16} />
                  </a>
                  {mapUrl ? null : (
                    <span className="site-muted site-hint">{t("site.venue.mapHint")}</span>
                  )}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </Section>
  );
}
