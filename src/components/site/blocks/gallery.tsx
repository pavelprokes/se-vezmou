import { ExternalLink, Lock } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { GalleryLightbox, type LightboxLabels } from "../gallery-lightbox";
import { galleryModel } from "../models";
import { Picture } from "../picture";
import { PinGate, UnlockedRegion } from "../pin-gate";
import { pinGateLabels } from "../pin-labels";
import { Section } from "./section";

/**
 * Galerie: vlastní fotografie páru (M7c, docs/adr/0006-photo-storage.md) a volitelný odkaz na externí
 * fotogalerii (např. u fotografa).
 *
 * Fotografie jsou `<picture>` se `srcset` (AVIF před WebP, rozměry, líné načítání) z vlastní adresy
 * `/media/…`; kliknutím se otevře přístupný prohlížeč (`GalleryLightbox`). Každá fotografie má popisek (`alt`),
 * nebo je označená jako dekorativní (`alt=""`); fotografie bez popisku, která není dekorativní, se nevykreslí
 * (WCAG 1.1.1). Fotografie chráněné PINem hostů (`photosProtected`) nejsou ve veřejném snímku ani v HTML:
 * jsou v citlivé části a bez PINu se místo nich ukáže výzva k zadání PINu.
 *
 * Odkaz na externí galerii je jen odkaz: web z cizí adresy nic nenačítá. Odkaz je vždy `https`, otevírá se na
 * jiném webu (a říká to text i pro čtečky, WCAG 3.2.5) s `noopener noreferrer`. Obrázek karty je KOPIE
 * uložená ve vlastním úložišti (`card.imageMediaId`), nikdy cizí adresa. Chráněný odkaz je mezi citlivými údaji
 * (`SensitiveContent.gallery`). V režimu poděkování po svatbě galerie zůstává (FR-WEB-4).
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
  const {
    url,
    title,
    titleLang,
    description,
    host,
    cardImage,
    items,
    photosProtected,
    linkProtected,
    gated,
    locked,
  } = galleryModel(block, ctx);
  const lightboxLabels: LightboxLabels = {
    open: t("site.gallery.open", { alt: "{alt}" }),
    openN: t("site.gallery.openN", { n: "{n}", total: "{total}" }),
    dialog: t("site.gallery.lightbox"),
    close: t("site.gallery.close"),
    prev: t("site.gallery.prev"),
    next: t("site.gallery.next"),
    counter: t("site.gallery.counter", { n: "{n}", total: "{total}" }),
  };

  const anchor = url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="site-linkcard">
      {cardImage ? (
        <span className="site-linkcard-image">
          {/* Obrázek karty je dekorativní: název a doména jsou v odkazu textem */}
          <Picture
            media={{ ...cardImage, decorative: true }}
            alt=""
            sizes="(min-width: 640px) 40rem, 100vw"
          />
        </span>
      ) : null}
      <span className="site-linkcard-title" lang={titleLang}>
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

  const grid = items.length > 0 ? <GalleryLightbox items={items} labels={lightboxLabels} /> : null;

  return (
    <Section block={block} ctx={ctx} tone={tone}>
      {photosProtected ? null : grid}
      {linkProtected ? null : anchor}
      {gated ? (
        locked ? (
          <div className="site-gate">
            <Icon icon={Lock} size={28} />
            <PinGate labels={pinGateLabels(t, "gallery")} locale={ctx.locale} unlockKey="gallery" />
          </div>
        ) : (
          <UnlockedRegion label={t("site.pin.unlocked")} unlockKey="gallery">
            {photosProtected ? grid : null}
            {linkProtected ? anchor : null}
          </UnlockedRegion>
        )
      ) : null}
    </Section>
  );
}
