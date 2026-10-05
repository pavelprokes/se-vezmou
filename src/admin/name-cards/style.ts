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
