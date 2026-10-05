import { contrastRatio, THRESHOLDS } from "@/design/contrast";
import { getPalette, templates, type ColorRole, type TemplateKey } from "@/site/themes/palettes";

/**
 * Vzhled jmenovky podle šablony webu páru. Jmenovky se tisknou na bílý papír (žádná plná plocha,
 * šetří toner a ořez nemusí být přesný), proto se barvy berou z palety jen tehdy, když mají na bílé
 * aspoň 4,5 : 1. Tmavé palety (Půlnoc, Noc, Limeta) mají světlý text, ten se nahradí barvou výchozí
 * palety šablony, nakonec téměř černou. Dekor (linka, lístek, kosočtverec) nenese sdělení.
 */

export const PAPER = "#FFFFFF";
const INK_FALLBACK = "#1B1B1B";

export type CardFont = "serif" | "sans";
export type CardOrnament = "rule" | "sprig" | "gem" | "bar";

interface TemplateCard {
  font: CardFont;
  ornament: CardOrnament;
  /** Role pro jméno v pořadí přednosti. */
  nameRoles: readonly ColorRole[];
}

export const TEMPLATE_CARDS: Record<TemplateKey, TemplateCard> = {
  editorial: { font: "serif", ornament: "rule", nameRoles: ["text", "display"] },
  eukalyptus: { font: "serif", ornament: "sprig", nameRoles: ["display", "accent", "text"] },
  chateau: { font: "serif", ornament: "gem", nameRoles: ["display", "accent", "text"] },
  modern: { font: "sans", ornament: "bar", nameRoles: ["text", "display"] },
};

export interface CardStyle {
  font: CardFont;
  ornament: CardOrnament;
  name: string;
  detail: string;
  ornamentColor: string;
}

function readable(color: string): boolean {
  return contrastRatio(color, PAPER) >= THRESHOLDS.text;
}

function visible(color: string): boolean {
  return contrastRatio(color, PAPER) >= 1.6;
}

export function cardStyle(template: TemplateKey, paletteKey: string): CardStyle {
  const card = TEMPLATE_CARDS[template];
  const palettes = [
    getPalette(template, paletteKey).colors,
    getPalette(template, templates[template].defaultPalette).colors,
  ];
  const pick = (roles: readonly ColorRole[], ok: (color: string) => boolean, fallback: string) => {
    for (const colors of palettes) {
      for (const role of roles) if (ok(colors[role])) return colors[role];
    }
    return fallback;
  };
  return {
    font: card.font,
    ornament: card.ornament,
    name: pick(card.nameRoles, readable, INK_FALLBACK),
    detail: pick(["muted", "text"], readable, INK_FALLBACK),
    ornamentColor: pick(["accent", "ornament", "decor2"], visible, INK_FALLBACK),
  };
}

/** Tvar dekoru v milimetrech (os y dolů), společný pro náhled (SVG) i PDF (`drawSvgPath`). */
export interface OrnamentShape {
  width: number;
  height: number;
  paths: readonly { d: string; mode: "fill" | "stroke"; strokeWidth?: number }[];
}

function leaf(x: number, up: boolean): string {
  const tip = up ? 0.6 : 4.4;
  const ctrl = up ? 0 : 5;
  const back = up ? 2.4 : 2.6;
  return `M${x} 2.5 Q${x + 2} ${ctrl} ${x + 4.5} ${tip} Q${x + 2.5} ${back} ${x} 2.5 Z`;
}

export const ORNAMENTS: Record<CardOrnament, OrnamentShape> = {
  rule: { width: 16, height: 1, paths: [{ d: "M0 0.5 H16", mode: "stroke", strokeWidth: 0.2 }] },
  gem: {
    width: 26,
    height: 3,
    paths: [
      { d: "M0 1.5 H10 M16 1.5 H26", mode: "stroke", strokeWidth: 0.2 },
      { d: "M13 0 L14.5 1.5 L13 3 L11.5 1.5 Z", mode: "fill" },
    ],
  },
  sprig: {
    width: 22,
    height: 5,
    paths: [
      { d: "M0.5 2.5 H21.5", mode: "stroke", strokeWidth: 0.25 },
      {
        d: [leaf(2, true), leaf(6, false), leaf(11, true), leaf(15, false)].join(" "),
        mode: "fill",
      },
    ],
  },
  bar: { width: 12, height: 1.2, paths: [{ d: "M0 0 H12 V1.2 H0 Z", mode: "fill" }] },
};
