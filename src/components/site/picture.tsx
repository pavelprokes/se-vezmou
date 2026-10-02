import { mediaSrc } from "@/lib/media/types";
import type { PublicMedia } from "@/site/types";

/**
 * Fotografie jako `<picture>` se `srcset` (docs/adr/0006-photo-storage.md, Doručování): AVIF před WebP, šířky
 * variant z databáze, s rozměry (žádný posun rozvržení) a `loading="lazy"` mimo první obrazovku. Prohlížeč
 * vybere první `<source>`, který umí, a z něj velikost podle `sizes`; `<img src>` je WebP největší varianty
 * (záloha pro vše ostatní). Adresy jsou vlastní (`/media/{id}/{šířka}`), nikdy cizí web.
 *
 * Starší snímky a vývojové fixtury nemají šířky variant: vykreslí se jediný obrázek na `src`.
 * Alternativní text: popisek, nebo prázdný `alt` u dekorativního obrázku (WCAG 1.1.1).
 */
export function Picture({
  media,
  alt,
  lang,
  sizes,
  loading = "lazy",
  className,
}: {
  media: PublicMedia;
  /** Hotový popisek (už ve správném jazyce); u dekorativního obrázku se nepoužije. */
  alt: string;
  lang?: string;
  sizes: string;
  loading?: "lazy" | "eager";
  className?: string;
}) {
  const text = media.decorative ? "" : alt;
  const language = media.decorative ? undefined : lang;
  const widths = [...media.widths].sort((a, b) => a - b);
  if (widths.length === 0) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- vlastní adresy a pevné varianty, optimalizace Next se nepoužívá
      <img
        src={media.src}
        width={media.width}
        height={media.height}
        alt={text}
        lang={language}
        sizes={sizes}
        loading={loading}
        decoding="async"
        className={className}
      />
    );
  }
  const srcSet = (format: "avif" | "webp") =>
    widths.map((width) => `${mediaSrc(media.id, width, format)} ${width}w`).join(", ");
  return (
    <picture>
      <source type="image/avif" srcSet={srcSet("avif")} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet("webp")} sizes={sizes} />
      <img
        src={mediaSrc(media.id, widths[widths.length - 1], "webp")}
        width={media.width}
        height={media.height}
        alt={text}
        lang={language}
        loading={loading}
        decoding="async"
        className={className}
      />
    </picture>
  );
}
