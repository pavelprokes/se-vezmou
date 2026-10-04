import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SectionTone = "parchment" | "warm" | "ink" | "cinnamon";

const toneClasses: Record<SectionTone, string> = {
  parchment: "bg-parchment text-ink",
  warm: "bg-warm text-ink",
  ink: "bg-ink text-parchment [--focus-ring:var(--color-parchment)]",
  cinnamon: "bg-cinnamon-deep text-parchment [--focus-ring:var(--color-parchment)]",
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
  /** Pořadové číslo sekce („01“): jen ozdoba nad nadpisem, čtečky ho přeskočí. */
  number?: number;
  tone?: "light" | "dark";
  align?: "start" | "center";
  className?: string;
}

/** Třídy nadpisu sekce (h2): písmo Fraunces, velký stupeň; sdílí je i sekce s vlastním rozvržením. */
export const sectionTitleClass =
  "font-display text-4xl leading-[1.05] font-normal tracking-tight text-balance md:text-5xl lg:text-6xl";

/** Třídy nadpisu položky ve sloupci s linkou nahoře (h3). */
export const itemTitleClass = "font-display text-2xl leading-snug font-medium md:text-[1.75rem]";

export function SectionHeading({
  id,
  title,
  lead,
  number,
  tone = "light",
  align = "start",
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn(align === "center" && "text-center", className)}>
      {number ? (
        <p
          aria-hidden="true"
          className={cn(
            "font-display mb-3 text-xl italic",
            tone === "dark" ? "text-linen" : "text-cinnamon-deep",
          )}
        >
          {String(number).padStart(2, "0")}
        </p>
      ) : null}
      <h2 id={id} className={sectionTitleClass}>
        {title}
      </h2>
      {lead ? (
        <p
          className={cn(
            "mt-5 max-w-2xl text-lg text-pretty md:text-xl",
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
