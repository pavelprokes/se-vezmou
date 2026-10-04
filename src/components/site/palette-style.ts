import type { CSSProperties } from "react";
import { getPalette } from "@/site/themes/palettes";
import type { PublicContent } from "@/site/types";

/** Barvy palety jako CSS proměnné `--s-*` (jediný způsob, jak šablona barvy dostane). */
export function paletteStyle(content: Pick<PublicContent, "template" | "palette">): CSSProperties {
  const palette = getPalette(content.template, content.palette);
  return Object.fromEntries(
    Object.entries(palette.colors).map(([role, value]) => [`--s-${role}`, value]),
  ) as CSSProperties;
}
