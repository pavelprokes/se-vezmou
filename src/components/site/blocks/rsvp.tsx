import { dayInZone, formatDay } from "@/site/format";
import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { rsvpIsOpen } from "../context";
import { rsvpLabels } from "../rsvp/labels";
import { RsvpPrivacyNotice } from "../rsvp/privacy-notice";
import { RsvpForm } from "../rsvp/rsvp-form";
import { Paragraphs, Section } from "./section";

/**
 * Sekce „Potvrdit účast“ (FR-RSVP-1 až 7): ve fázi `rsvp_open` formulář (slepé ověření jména,
 * domácnosti, větvení podle událostí, otázky podle nastavení páru), jinak jen stav (ještě neotevřeno,
 * uzavřeno). V režimu poděkování po svatbě se nevykresluje (`renderableBlocks`).
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
  const closesAt = ctx.rsvp?.closesAt ?? null;
  const closes = closesAt ? formatDay(dayInZone(closesAt, content.timezone), ctx.locale) : null;

  return (
    <Section block={block} ctx={ctx} tone={tone}>
      <Paragraphs value={block.data.intro} ctx={ctx} className="site-lead" />
      {open ? <RsvpPrivacyNotice t={t} locale={ctx.locale} partners={content.partners} /> : null}
      {open ? (
        <RsvpForm
          labels={rsvpLabels(t)}
          locale={ctx.locale}
          initial={ctx.rsvp?.initial ?? { stage: "name" }}
          allowUnlisted={ctx.rsvp?.allowUnlisted ?? false}
          closes={closes}
        />
      ) : (
        <p className="site-rsvp-status">
          {content.phase === "save_the_date" ? t("site.rsvp.notYet") : t("site.rsvp.closed")}
        </p>
      )}
    </Section>
  );
}
