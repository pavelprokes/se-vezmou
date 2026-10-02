import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { rsvpIsOpen } from "../context";
import { Paragraphs, Section } from "./section";

/**
 * Sekce „Potvrdit účast“. Samotný formulář přinese M8 (slepé ověření jména, domácnosti, větvení);
 * zde je kotva, úvodní text a stav (otevřeno, uzavřeno, ještě neotevřeno).
 * V režimu poděkování po svatbě se nevykresluje (`renderableBlocks`).
 */
export function Rsvp({
  block,
  ctx,
  tone,
}: {
  block: BlockOf<"rsvp">;
  ctx: SiteCtx;
  tone: "bg" | "surface";
}) {
  const { t, content } = ctx;
  const open = rsvpIsOpen(content);
  const status = open
    ? t("site.rsvp.placeholder") // TODO(M8): sem přijde formulář potvrzení účasti
    : content.phase === "save_the_date"
      ? t("site.rsvp.notYet")
      : t("site.rsvp.closed");

  return (
    <Section block={block} ctx={ctx} tone={tone}>
      <Paragraphs value={block.data.intro} ctx={ctx} className="site-lead" />
      <p className="site-rsvp-status">{status}</p>
    </Section>
  );
}
