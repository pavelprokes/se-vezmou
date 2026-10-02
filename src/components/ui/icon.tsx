import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface IconProps {
  icon: LucideIcon;
  /** Popisek pro čtečky. Bez popisku je ikona jen dekorace a čtečky ji přeskočí. */
  label?: string;
  size?: number;
  className?: string;
}

/**
 * Obálka pro ikony Lucide: vždy `stroke-width` 2, ikona s významem má `role="img"`
 * a popisek, dekorativní je skrytá před čtečkami (WCAG 1.1.1).
 */
export function Icon({ icon: Glyph, label, size = 20, className }: IconProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={2}
      className={cn("shrink-0", className)}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true, focusable: false })}
    />
  );
}
