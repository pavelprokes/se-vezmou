import { ChevronDown } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import type { BlockOf } from "@/site/types";
import type { SiteCtx } from "../context";
import { Paragraphs, Section } from "./section";

/**
 * Časté otázky na nativním `<details>`: funguje bez JavaScriptu, klávesnicí (Enter, mezerník)
 * a čtečky stav „rozbaleno“ ohlašují samy.
 */
export function Faq({
  block,
  ctx,
  tone,
}: {
  block: BlockOf<"faq">;
  ctx: SiteCtx;
  tone: "bg" | "surface";
}) {
  const items = block.data.items.filter((i) => ctx.text(i.question) && ctx.text(i.answer));
  return (
    <Section block={block} ctx={ctx} tone={tone}>
      <div className="site-faq">
        {items.map((item) => (
          <details key={item.id} className="site-faq-item">
            <summary className="site-faq-summary" lang={ctx.lang(item.question)}>
              <span>{ctx.text(item.question)}</span>
              <Icon icon={ChevronDown} className="site-faq-chevron" />
            </summary>
            <div className="site-faq-answer">
              <Paragraphs value={item.answer} ctx={ctx} />
            </div>
          </details>
        ))}
      </div>
    </Section>
  );
}
