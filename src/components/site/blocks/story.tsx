import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { Picture } from "../picture";
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
  const media = ctx.media(block.data.mediaId);
  const alt = media ? ctx.text(media.alt) : "";
  const showImage = media && (media.decorative || alt !== "");
  return (
    <Section block={block} ctx={ctx} tone={tone}>
      <div className="site-story" data-with-image={showImage ? "true" : undefined}>
        <div className="site-prose">
          <Paragraphs value={block.data.text} ctx={ctx} />
        </div>
        {showImage ? (
          <figure className="site-figure">
            <Picture
              media={media}
              alt={alt}
              lang={ctx.lang(media.alt)}
              sizes="(min-width: 768px) 40vw, 100vw"
            />
          </figure>
        ) : null}
      </div>
    </Section>
  );
}
