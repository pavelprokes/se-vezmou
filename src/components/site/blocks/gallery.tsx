import Image from "next/image";
import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { Section } from "./section";

/**
 * Galerie: každý obrázek má popisek (`alt`), nebo je označený jako dekorativní (`alt=""`).
 * Obrázek bez popisku, který není dekorativní, se nevykreslí (WCAG 1.1.1).
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
  const items = block.data.mediaIds
    .map((id) => ctx.media(id))
    .filter((m) => m !== undefined)
    .map((media) => ({ media, alt: ctx.text(media.alt) }))
    .filter(({ media, alt }) => media.decorative || alt !== "");

  return (
    <Section block={block} ctx={ctx} tone={tone}>
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
    </Section>
  );
}
