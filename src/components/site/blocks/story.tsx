import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { Picture } from "../picture";
import { storyImage } from "../models";
import { Paragraphs, Section } from "./section";

/** Náš příběh: text a volitelný obrázek (s popiskem nebo dekorativní). */
export function Story({
  block,
  ctx,
  tone,
}: {
  block: BlockOf<"story">;
  ctx: SiteCtx;
  tone: "bg" | "surface";
}) {
  const image = storyImage(block, ctx);
  return (
    <Section block={block} ctx={ctx} tone={tone}>
      <div className="site-story" data-with-image={image ? "true" : undefined}>
        <div className="site-prose">
          <Paragraphs value={block.data.text} ctx={ctx} />
        </div>
        {image ? (
          <figure className="site-figure">
            <Picture
              media={image.media}
              alt={image.alt}
              lang={image.lang}
              sizes="(min-width: 768px) 40vw, 100vw"
            />
          </figure>
        ) : null}
      </div>
    </Section>
  );
}
