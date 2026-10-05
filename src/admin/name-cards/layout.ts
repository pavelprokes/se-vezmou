/**
 * Jmenovky na stůl: rozložení na A4 a ořezové značky (docs/konkurence-2026-10.md, Jmenovky).
 *
 * Karty leží těsně vedle sebe bez spadávky (pozadí je bílý papír), takže se na každé linii řeže
 * jen jednou. Ořezové značky jsou jen vně mřížky: 0,3 pt, 3 mm od ořezu, 5 mm dlouhé. Domácí
 * tiskárny netisknou 3 až 5 mm od kraje listu, proto mřížka nechává na každé straně aspoň 13 mm.
 * Všechny míry jsou v milimetrech, počátek je levý horní roh listu.
 */

export const A4_MM = { width: 210, height: 297 } as const;
export const MARK = { offset: 3, length: 5, weightPt: 0.3 } as const;

export const nameCardFormats = ["flat", "tent"] as const;
export type NameCardFormat = (typeof nameCardFormats)[number];

export interface FormatSpec {
  /** Rozměr karty na listu (u stojánku rozložený). */
  width: number;
  height: number;
  cols: number;
  rows: number;
  /** Stojánek se přehýbá v polovině výšky; horní polovina je zadní strana (otočená). */
  fold: boolean;
}

export const FORMATS: Record<NameCardFormat, FormatSpec> = {
  // Plochá 90 × 50 mm (v ČR běžná 9 × 5 cm): 2 × 5 = 10 na A4 na výšku.
  flat: { width: 90, height: 50, cols: 2, rows: 5, fold: false },
  // Stojánek 90 × 45 mm složený, 90 × 90 mm rozložený: 2 × 3 = 6 na A4 na výšku.
  tent: { width: 90, height: 90, cols: 2, rows: 3, fold: true },
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function perSheet(format: NameCardFormat): number {
  const spec = FORMATS[format];
  return spec.cols * spec.rows;
}

/** Mřížka karet vycentrovaná na listu. */
export function gridRect(format: NameCardFormat): Rect {
  const spec = FORMATS[format];
  const width = spec.cols * spec.width;
  const height = spec.rows * spec.height;
  return { x: (A4_MM.width - width) / 2, y: (A4_MM.height - height) / 2, width, height };
}

/** Pozice karet na listu po řádcích zleva doprava. */
export function cardRects(format: NameCardFormat): Rect[] {
  const spec = FORMATS[format];
  const grid = gridRect(format);
  const rects: Rect[] = [];
  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.cols; col += 1) {
      rects.push({
        x: grid.x + col * spec.width,
        y: grid.y + row * spec.height,
        width: spec.width,
        height: spec.height,
      });
    }
  }
  return rects;
}

/** Ořezové značky: u každé svislé linie řezu nahoře a dole, u každé vodorovné vlevo a vpravo. */
export function cropMarks(format: NameCardFormat): Segment[] {
  const spec = FORMATS[format];
  const grid = gridRect(format);
  const marks: Segment[] = [];
  const top = grid.y - MARK.offset;
  const bottom = grid.y + grid.height + MARK.offset;
  const left = grid.x - MARK.offset;
  const right = grid.x + grid.width + MARK.offset;
  for (let col = 0; col <= spec.cols; col += 1) {
    const x = grid.x + col * spec.width;
    marks.push({ x1: x, y1: top - MARK.length, x2: x, y2: top });
    marks.push({ x1: x, y1: bottom, x2: x, y2: bottom + MARK.length });
  }
  for (let row = 0; row <= spec.rows; row += 1) {
    const y = grid.y + row * spec.height;
    marks.push({ x1: left - MARK.length, y1: y, x2: left, y2: y });
    marks.push({ x1: right, y1: y, x2: right + MARK.length, y2: y });
  }
  return marks;
}

/** Značky přehybu stojánku: krátké linky vně mřížky v polovině výšky každé řady. */
export function foldMarks(format: NameCardFormat): Segment[] {
  const spec = FORMATS[format];
  if (!spec.fold) return [];
  const grid = gridRect(format);
  const left = grid.x - MARK.offset;
  const right = grid.x + grid.width + MARK.offset;
  return Array.from({ length: spec.rows }, (_, row) => {
    const y = grid.y + row * spec.height + spec.height / 2;
    return [
      { x1: left - MARK.length, y1: y, x2: left, y2: y },
      { x1: right, y1: y, x2: right + MARK.length, y2: y },
    ];
  }).flat();
}

/** Rozdělí jmenovky po listech. */
export function paginate<T>(items: readonly T[], format: NameCardFormat): T[][] {
  const size = perSheet(format);
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

export const NAME_SIZE = { max: 22, min: 14, twoLineMax: 18, floor: 9 } as const;

export interface FittedName {
  sizePt: number;
  lines: string[];
}

/**
 * Velikost jména, aby se vešlo do šířky: jeden řádek od 22 pt dolů až na 14 pt; když ani to nestačí,
 * dva řádky (zlom za spojovníkem, jinak na mezeře nejblíž středu) od 18 pt dolů. Krajní případ
 * (jedno velmi dlouhé slovo) se zmenší, dokud se nevejde, nejméně na 9 pt.
 * `measure(text, sizePt)` vrací šířku v milimetrech.
 */
export function fitName(
  name: string,
  maxWidth: number,
  measure: (text: string, sizePt: number) => number,
): FittedName {
  const text = name.trim().replace(/\s+/g, " ");
  for (let size = NAME_SIZE.max; size >= NAME_SIZE.min; size -= 1) {
    if (measure(text, size) <= maxWidth) return { sizePt: size, lines: [text] };
  }
  const lines = splitName(text);
  if (lines.length === 2) {
    for (let size = NAME_SIZE.twoLineMax; size >= NAME_SIZE.floor; size -= 1) {
      if (lines.every((line) => measure(line, size) <= maxWidth)) return { sizePt: size, lines };
    }
    return { sizePt: NAME_SIZE.floor, lines };
  }
  for (let size = NAME_SIZE.min - 1; size > NAME_SIZE.floor; size -= 1) {
    if (measure(text, size) <= maxWidth) return { sizePt: size, lines: [text] };
  }
  return { sizePt: NAME_SIZE.floor, lines: [text] };
}

/** Zlom do dvou řádků: za spojovníkem nejblíž středu (spojovník zůstane na konci řádku), jinak na mezeře. */
export function splitName(text: string): string[] {
  const middle = text.length / 2;
  let best: { at: number; keep: number } | null = null;
  for (let i = 1; i < text.length - 1; i += 1) {
    const ch = text[i];
    if (ch !== " " && ch !== "-") continue;
    const candidate = { at: i, keep: ch === "-" ? 1 : 0 };
    // spojovník má přednost před mezerou, mezi stejnými rozhoduje vzdálenost od středu
    if (
      best === null ||
      (ch === "-" && text[best.at] !== "-") ||
      (ch === text[best.at] && Math.abs(i - middle) < Math.abs(best.at - middle))
    ) {
      best = candidate;
    }
  }
  if (!best) return [text];
  return [text.slice(0, best.at + best.keep).trim(), text.slice(best.at + 1).trim()];
}
