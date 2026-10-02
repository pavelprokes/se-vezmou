import { ExternalLink, Lock } from "lucide-react";
import Image from "next/image";
import { Icon } from "@/components/ui/icon";
import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { PinGate, UnlockedRegion } from "../pin-gate";
import { pinGateLabels } from "../pin-labels";
import { Section } from "./section";

/**
 * Galerie: každý obrázek má popisek (`alt`), nebo je označený jako dekorativní (`alt=""`).
 * Obrázek bez popisku, který není dekorativní, se nevykreslí (WCAG 1.1.1).
 *
 * Nahrávání fotek se nepodporuje (OQ-47). Místo něj může pár uvést odkaz na externí fotogalerii
 * (např. u fotografa): je to jen odkaz, web z cizí adresy nic nenačítá. Odkaz je vždy `https`,
 * otevírá se na jiném webu (a říká to text i pro čtečky, WCAG 3.2.5) s `noopener noreferrer`.
 * Chráněný odkaz je mezi citlivými údaji (`SensitiveContent.gallery`): bez PINu hostů není ani
 * v HTML, ani v RSC payloadu. V režimu poděkování po svatbě galerie zůstává (FR-WEB-4).
 */
export function Gallery({
  block,
  ctx,
  tone,
}: {
  block: BlockOf<"gallery">;
  ctx: SiteCtx;
  tone: "bg" | "surface";
}) {
  const { t } = ctx;
  const items = block.data.mediaIds
    .map((id) => ctx.media(id))
    .filter((m) => m !== undefined)
    .map((media) => ({ media, alt: ctx.text(media.alt) }))
    .filter(({ media, alt }) => media.decorative || alt !== "");

  const link = block.data.link;
  const url = link
    ? link.protected
      ? ctx.sensitiveUnlocked
        ? (ctx.sensitive?.gallery?.url ?? null)
        : null
      : link.url
    : null;
  // Karta: název (text odkazu od páru přepisuje název z cílové stránky), popis a doména. Obrázek
  // z cílové stránky se záměrně nevykresluje (host nesmí volat cizí web, OQ-47).
  const card = link ? (link.protected ? (ctx.sensitive?.gallery?.card ?? null) : link.card) : null;
  const fetched = card?.status === "ok" ? card : null;
  const ownTitle = link ? ctx.text(link.label) : "";
  const title = ownTitle || fetched?.title || t("site.gallery.linkDefault");
  const description = fetched?.description ?? null;
  let host = "";
  try {
    host = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }

  const anchor = url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="site-linkcard">
      <span
        className="site-linkcard-title"
        lang={ownTitle && link ? ctx.lang(link.label) : undefined}
      >
        {title}
      </span>
      {description ? <span className="site-linkcard-desc">{description}</span> : null}
      <span className="site-linkcard-meta">
        <Icon icon={ExternalLink} size={18} />
        <span>{host}</span>
        <span className="site-muted">({t("site.gallery.external")})</span>
      </span>
    </a>
  ) : null;

  return (
    <Section block={block} ctx={ctx} tone={tone}>
      {items.length > 0 ? (
        <ul className="site-gallery">
          {items.map(({ media, alt }) => (
            <li key={media.id}>
              <figure className="site-figure">
                <Image
                  src={media.src}
                  width={media.width}
                  height={media.height}
                  alt={media.decorative ? "" : alt}
                  lang={media.decorative ? undefined : ctx.lang(media.alt)}
                  sizes="(min-width: 768px) 30vw, 100vw"
                  loading="lazy"
                  unoptimized
                />
              </figure>
            </li>
          ))}
        </ul>
      ) : null}
      {link ? (
        link.protected && !url ? (
          <div className="site-gate">
            <Icon icon={Lock} size={28} />
            <PinGate labels={pinGateLabels(t, "gallery")} locale={ctx.locale} unlockKey="gallery" />
          </div>
        ) : link.protected ? (
          <UnlockedRegion label={t("site.pin.unlocked")} unlockKey="gallery">
            {anchor}
          </UnlockedRegion>
        ) : (
          anchor
        )
      ) : null}
    </Section>
  );
}
