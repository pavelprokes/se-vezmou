import { Heart, Music, Wine, type LucideIcon } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import type { BlockOf, PublicEvent } from "@/site/types";
import type { SiteCtx } from "../context";
import { programDays } from "../models";
import { Paragraphs, Section } from "./section";

/** Zástupný znak místa ve větě "v {place}": název místa může být v záložním jazyce a dostane vlastní `lang` (3.1.2). */
const PLACE_MARK = "";

function placeAt(sentence: string, name: Parameters<SiteCtx["text"]>[0], ctx: SiteCtx) {
  const [before, after = ""] = sentence.split(PLACE_MARK);
  return (
    <>
      {before}
      <span lang={ctx.lang(name)}>{ctx.text(name)}</span>
      {after}
    </>
  );
}

const KIND_ICON: Record<PublicEvent["kind"], LucideIcon> = {
  ceremony: Heart,
  reception: Wine,
  other: Music,
};

/** Program po hodinách; vícedenní svatba se seskupí podle dne v časovém pásmu svatby. */
export function Program({
  block,
  ctx,
  tone,
}: {
  block: BlockOf<"program">;
  ctx: SiteCtx;
  tone: "bg" | "surface";
}) {
  const { t } = ctx;
  const { days, multiDay } = programDays(ctx);

  return (
    <Section block={block} ctx={ctx} tone={tone}>
      <Paragraphs value={block.data.intro} ctx={ctx} className="site-lead" />
      {days.map(({ day, label, entries }) => (
        <div key={day} className="site-program-day">
          {multiDay ? <h3 className="site-h3">{label}</h3> : null}
          <ol className="site-program">
            {entries.map(({ event, venue, start, end }) => {
              return (
                <li key={event.id} className="site-program-item">
                  <p className="site-program-time">
                    <time dateTime={event.startsAt}>{start}</time>
                    {end ? (
                      <>
                        {" – "}
                        <time dateTime={event.endsAt ?? undefined}>{end}</time>
                      </>
                    ) : null}
                  </p>
                  <div>
                    <h3 className="site-h3 site-program-title">
                      <Icon icon={KIND_ICON[event.kind]} />
                      <span lang={ctx.lang(event.title)}>{ctx.text(event.title)}</span>
                    </h3>
                    <Paragraphs value={event.description} ctx={ctx} className="site-muted" />
                    {venue ? (
                      <p className="site-muted">
                        {placeAt(t("site.program.at", { place: PLACE_MARK }), venue.name, ctx)}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </Section>
  );
}
