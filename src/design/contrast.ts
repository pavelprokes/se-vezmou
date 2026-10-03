/**
 * Kontrast barev podle WCAG 2.2 (relativní luminance, 1.4.3 a 1.4.11).
 * Čistá funkce bez závislostí; přesně takto bude později kontrolovat i palety šablon.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Přečte `#rgb`, `#rrggbb`, `rgb(...)` nebo `rgba(...)`. */
export function parseColor(value: string): Rgba {
  const input = value.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(input);
  if (hex) {
    const full =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((c) => c + c)
            .join("")
        : hex[1];
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }

  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(input);
  if (fn) {
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] ? Number(fn[4]) : 1 };
  }

  throw new Error(`Neznámý zápis barvy: ${value}`);
}

/** Průhlednou barvu smíchá s neprůhledným podkladem (jak ji uvidí uživatel). */
export function blend(foreground: Rgba, background: Rgba): Rgba {
  const a = foreground.a;
  return {
    r: Math.round(foreground.r * a + background.r * (1 - a)),
    g: Math.round(foreground.g * a + background.g * (1 - a)),
    b: Math.round(foreground.b * a + background.b * (1 - a)),
    a: 1,
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Poměr kontrastu 1 až 21. Průhledná barva popředí se nejdřív smíchá s podkladem. */
export function contrastRatio(foreground: string, background: string): number {
  const bg = parseColor(background);
  if (bg.a < 1) throw new Error("Podklad musí být neprůhledný");
  const fg = blend(parseColor(foreground), bg);
  const [light, dark] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Prahy podle WCAG: běžný text (1.4.3) a velký text a prvky rozhraní (1.4.3, 1.4.11). */
export const THRESHOLDS = { text: 4.5, large: 3, ui: 3 } as const;
