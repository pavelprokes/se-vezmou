import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SectionTone = "parchment" | "warm" | "ink" | "cinnamon";

const toneClasses: Record<SectionTone, string> = {
  parchment: "bg-parchment text-ink",
  warm: "bg-warm text-ink",
  ink: "bg-ink text-parchment",
  cinnamon: "bg-cinnamon-deep text-parchment",
};

export interface SectionProps {
  /** Kotva pro odkazy z navigace. */
  id?: string;
  /** `id` nadpisu sekce; sekce se tím stane pojmenovanou oblastí. */
  headingId: string;
  tone?: SectionTone;
  className?: string;
  children: ReactNode;
}

/** Sekce úvodní stránky: plná plocha, vnitřní sloupec 72 rem, svislé odstupy shodné pro všechny. */
export function Section({ id, headingId, tone = "parchment", className, children }: SectionProps) {
  return (
    <section id={id} aria-labelledby={headingId} className={cn(toneClasses[tone], "scroll-mt-4")}>
      <div className={cn("mx-auto w-full max-w-6xl px-4 py-16 sm:px-8 md:py-24", className)}>
        {children}
      </div>
    </section>
  );
}

export interface SectionHeadingProps {
  id: string;
  title: ReactNode;
  /** Odpovědní blok: 1 až 2 samostatné věty hned pod nadpisem (GEO). */
  lead?: ReactNode;
  tone?: "light" | "dark";
  align?: "start" | "center";
  className?: string;
}

export function SectionHeading({
  id,
  title,
  lead,
  tone = "light",
  align = "start",
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn(align === "center" && "text-center", className)}>
      <h2
        id={id}
        className="font-sans text-3xl leading-tight font-bold tracking-tight text-balance md:text-4xl"
      >
        {title}
      </h2>
      {lead ? (
        <p
          className={cn(
            "mt-4 max-w-2xl text-lg text-pretty",
            tone === "dark" ? "text-linen" : "text-muted",
            align === "center" && "mx-auto",
          )}
        >
          {lead}
        </p>
      ) : null}
    </div>
  );
}
