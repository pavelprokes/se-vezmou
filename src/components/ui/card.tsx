import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article";
  tone?: "warm" | "linen";
}

/** Karta: plná plocha bez stínu a přechodu. Nadpis si dodává obsah (`<h2>` apod.). */
export function Card({ as: Tag = "div", tone = "warm", className, ...props }: CardProps) {
  return (
    <Tag
      className={cn(
        "border-hairline text-ink rounded-2xl border p-6",
        tone === "warm" ? "bg-warm" : "bg-linen",
        className,
      )}
      {...props}
    />
  );
}
