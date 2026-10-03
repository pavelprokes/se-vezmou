import { BedDouble, Bus, ExternalLink, Shirt } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { googleMapsUrl, mapyCzUrl } from "@/site/map/view";
import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { Paragraphs, Section } from "./section";

type Tone = "bg" | "surface";

/** Ubytování a doprava. */
export function Lodging({
  block,
  ctx,
  tone,
}: {
  block: BlockOf<"lodging">;
  ctx: SiteCtx;
  tone: Tone;
}) {
  const { t } = ctx;
  const hasTransport = ctx.text(block.data.transport) !== "";
  return (
    <Section block={block} ctx={ctx} tone={tone}>
      <div className="site-cards">
        {block.data.items.length > 0 ? (
          <article className="site-card" aria-labelledby="lodging-stay">
            <h3 id="lodging-stay" className="site-h3 site-icon-title">
              <Icon icon={BedDouble} />
              {t("site.lodging.stay")}
            </h3>
            <ul className="site-list">
              {block.data.items.map((item) => (
                <li key={item.id}>
                  <p className="site-strong" lang={ctx.lang(item.name)}>
                    {item.url ? (
                      <a href={item.url} rel="noopener noreferrer" className="site-link">
                        {ctx.text(item.name)}
                        <Icon icon={ExternalLink} size={16} />
                      </a>
                    ) : (
                      ctx.text(item.name)
                    )}
                  </p>
                  {item.address ? <address className="site-muted">{item.address}</address> : null}
                  <Paragraphs value={item.description} ctx={ctx} className="site-muted" />
                  {item.lat !== null && item.lng !== null ? (
                    <p className="site-map-links">
                      <a
                        href={mapyCzUrl(item.lat, item.lng)}
                        rel="noopener noreferrer"
                        className="site-link"
                      >
                        {t("site.venue.mapyCz")}
                        <Icon icon={ExternalLink} size={16} />
                      </a>
                      <a
                        href={googleMapsUrl(item.lat, item.lng)}
                        rel="noopener noreferrer"
                        className="site-link"
                      >
                        {t("site.venue.googleMaps")}
                        <Icon icon={ExternalLink} size={16} />
                      </a>
                      <span className="site-muted site-hint">{t("site.venue.mapHint")}</span>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </article>
        ) : null}
        {hasTransport ? (
          <article className="site-card" aria-labelledby="lodging-transport">
            <h3 id="lodging-transport" className="site-h3 site-icon-title">
              <Icon icon={Bus} />
              {t("site.lodging.transport")}
            </h3>
            <Paragraphs value={block.data.transport} ctx={ctx} />
          </article>
        ) : null}
      </div>
    </Section>
  );
}

/** Dress code. */
export function DressCode({
  block,
  ctx,
  tone,
}: {
  block: BlockOf<"dresscode">;
  ctx: SiteCtx;
  tone: Tone;
}) {
  return (
    <Section block={block} ctx={ctx} tone={tone}>
      <div className="site-dresscode">
        <Icon icon={Shirt} size={28} />
        <div>
          <Paragraphs value={block.data.text} ctx={ctx} className="site-lead" />
        </div>
      </div>
    </Section>
  );
}
