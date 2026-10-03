import type { ReactNode } from "react";
import type { Block } from "@/site/types";
import { Divider } from "../ornaments";
import { BLOCK_TITLE, type SiteCtx } from "../context";

export interface SectionProps {
  block: Exclude<Block, { type: "hero" }>;
  ctx: SiteCtx;
  /** Střídání podkladu `bg` a `surface` pro rytmus dlouhé stránky. */
  tone: "bg" | "surface";
  children: ReactNode;
  /** Obsah přes celou šířku za textem sekce (mimo `.site-wrap`), např. mapa místa konání. */
  after?: ReactNode;
}

/** Společný obal bloku: kotva, nadpis druhé úrovně a oddělovač podle šablony. */
export function Section({ block, ctx, tone, children, after }: SectionProps) {
  const headingId = `${block.anchor}-nadpis`;
  return (
    <section
      id={block.anchor}
      aria-labelledby={headingId}
      className="site-section"
      data-tone={tone}
      data-block={block.type}
    >
      <div className="site-wrap">
        <h2 id={headingId} className="site-h2">
          {ctx.t(BLOCK_TITLE[block.type])}
        </h2>
        <Divider template={ctx.content.template} />
        {children}
      </div>
      {after}
    </section>
  );
}

/** Texty bloku jako odstavce; jazyk se označí, když se zobrazil náhradní. */
export function Paragraphs({
  value,
  ctx,
  className,
}: {
  value: Parameters<SiteCtx["text"]>[0];
  ctx: SiteCtx;
  className?: string;
}) {
  const lang = ctx.lang(value);
  return (
    <>
      {ctx.paragraphs(value).map((paragraph, index) => (
        <p key={index} lang={lang} className={className}>
          {paragraph}
        </p>
      ))}
    </>
  );
}
