import { A4_MM, MARK, type Rect, type Segment } from "@/admin/name-cards/layout";
import { ORNAMENTS, type CardStyle } from "@/admin/name-cards/style";
import { PT_TO_MM } from "@/admin/name-cards/face";

/**
 * Cedulka s QR kódem galerie na stůl (fáze 1, docs/plan-funkci-2026-10.md). Dva formáty:
 *
 * - `frame`: 10 × 15 cm na výšku, rozměr běžných fotorámečků a plexi stojánků; dvě na A4 naležato.
 * - `a5`: A5 na výšku (148 × 210 mm) pro vchod nebo fotokoutek; jedna na A4 na výšku.
 *
 * Obě mají kolem mřížky aspoň 13 mm (domácí tiskárny netisknou u kraje) a ořezové značky jen vně,
 * stejně jako jmenovky. QR má na cedulce 10 × 15 aspoň 50 mm: přečte se telefonem z běžné
 * vzdálenosti od stolu (zhruba desetina vzdálenosti, tedy do půl metru až metru).
 * Všechny míry jsou v milimetrech, počátek vlevo nahoře, osa y dolů. Stejné rozvržení kreslí náhled
 * (SVG) i PDF.
 */

export const gallerySignFormats = ["frame", "a5"] as const;
export type GallerySignFormat = (typeof gallerySignFormats)[number];

interface SignFormatSpec {
  width: number;
  height: number;
  cols: number;
  rows: number;
  landscape: boolean;
}

export const SIGN_FORMATS: Record<GallerySignFormat, SignFormatSpec> = {
  frame: { width: 100, height: 150, cols: 2, rows: 1, landscape: true },
  a5: { width: 148, height: 210, cols: 1, rows: 1, landscape: false },
};

export function signPage(format: GallerySignFormat): { width: number; height: number } {
  return SIGN_FORMATS[format].landscape
    ? { width: A4_MM.height, height: A4_MM.width }
    : { width: A4_MM.width, height: A4_MM.height };
}

export function signGrid(format: GallerySignFormat): Rect {
  const spec = SIGN_FORMATS[format];
  const page = signPage(format);
  const width = spec.cols * spec.width;
  const height = spec.rows * spec.height;
  return { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height };
}

export function signRects(format: GallerySignFormat): Rect[] {
  const spec = SIGN_FORMATS[format];
  const grid = signGrid(format);
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

/** Ořezové značky vně mřížky u každé linie řezu (jako u jmenovek). */
export function signCropMarks(format: GallerySignFormat): Segment[] {
  const spec = SIGN_FORMATS[format];
  const grid = signGrid(format);
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

export type SignFont = "display" | "sans" | "bold";
export type SignTone = "name" | "detail" | "accent";

/** Šířka textu v milimetrech pro písmo a velikost v bodech. */
export type SignMeasure = (text: string, font: SignFont, sizePt: number) => number;

export interface SignContent {
  /** Jména páru, nahoře drobně verzálkami. */
  couple: string;
  heading: string;
  instruction: string;
  /** Druhý jazyk (web ve dvou jazycích): menší, pod hlavním. */
  secondary: { heading: string; instruction: string } | null;
  /** Čitelná adresa pod kódem (bez parametrů). */
  url: string;
}

export interface SignText {
  text: string;
  /** Střed řádku. */
  x: number;
  /** Účaří. */
  y: number;
  sizePt: number;
  font: SignFont;
  tone: SignTone;
}

export interface SignLayout {
  width: number;
  height: number;
  texts: SignText[];
  ornament: { x: number; y: number; scale: number };
  qr: { x: number; y: number; size: number };
}

const ASCENT = 0.78;
const LINE = 1.28;

/** Zalomí text do řádků nejvýš `maxLines`; když se nevejde, zmenšuje písmo po půl bodu až na `min`. */
export function wrapFit(
  text: string,
  font: SignFont,
  maxWidth: number,
  size: { max: number; min: number },
  maxLines: number,
  measure: SignMeasure,
): { lines: string[]; sizePt: number } {
  // jen obyčejné mezery: nezlomitelné (za jednopísmennými předložkami) drží slova pohromadě
  const words = text.split(/[ \t\n]+/).filter(Boolean);
  for (let sizePt = size.max; sizePt >= size.min - 1e-9; sizePt -= 0.5) {
    const lines: string[] = [];
    let current = "";
    let fits = true;
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate, font, sizePt) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current = word;
      if (measure(word, font, sizePt) > maxWidth) fits = false;
    }
    if (current) lines.push(current);
    if (fits && lines.length <= maxLines) return { lines, sizePt };
  }
  // Krajní případ (dlouhé slovo nebo adresa): nejmenší písmo, řádky navíc se zahodí.
  const sizePt = size.min;
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, font, sizePt) <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return { lines: lines.slice(0, maxLines), sizePt };
}

/** Jeden řádek do šířky: zmenšit, pak zkrátit třemi tečkami. */
function fitLine(
  text: string,
  font: SignFont,
  maxWidth: number,
  size: { max: number; min: number },
  measure: SignMeasure,
): { text: string; sizePt: number } {
  for (let sizePt = size.max; sizePt >= size.min - 1e-9; sizePt -= 0.5) {
    if (measure(text, font, sizePt) <= maxWidth) return { text, sizePt };
  }
  let cut = text;
  while (cut.length > 1 && measure(`${cut}…`, font, size.min) > maxWidth) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}…`, sizePt: size.min };
}

/**
 * Rozvržení cedulky. Míry jsou navržené pro 10 × 15 cm a pro A5 se násobí poměrem výšek (1,4),
 * vodorovně se vše centruje. Pořadí shora: dekor šablony, jména páru, nadpis (a nadpis druhého
 * jazyka), QR kód, pokyn (a pokyn druhého jazyka), čitelná adresa.
 */
export function signLayout(
  format: GallerySignFormat,
  content: SignContent,
  style: CardStyle,
  measure: SignMeasure,
): SignLayout {
  const { width, height } = SIGN_FORMATS[format];
  const s = height / 150;
  const cx = width / 2;
  const maxWidth = width - 2 * 9 * s;
  const texts: SignText[] = [];
  const mm = (pt: number) => pt * PT_TO_MM;

  let y = 11 * s;
  const ornamentShape = ORNAMENTS[style.ornament];
  const scale = (26 * s) / Math.max(ornamentShape.width, 12);
  const ornament = { x: cx - (ornamentShape.width * scale) / 2, y, scale };
  y += ornamentShape.height * scale + 6 * s;

  const kicker = fitLine(
    content.couple.toLocaleUpperCase(),
    "bold",
    maxWidth,
    { max: 8 * s, min: 6 * s },
    measure,
  );
  y += mm(kicker.sizePt) * ASCENT;
  texts.push({ ...kicker, x: cx, y, font: "bold", tone: "accent" });
  y += 5 * s;

  const heading = wrapFit(
    content.heading,
    "display",
    maxWidth,
    { max: 21 * s, min: 13 * s },
    2,
    measure,
  );
  for (const [index, line] of heading.lines.entries()) {
    y += index === 0 ? mm(heading.sizePt) * ASCENT : mm(heading.sizePt) * LINE * 0.92;
    texts.push({ text: line, x: cx, y, sizePt: heading.sizePt, font: "display", tone: "name" });
  }
  if (content.secondary) {
    const second = fitLine(
      content.secondary.heading,
      "display",
      maxWidth,
      { max: 11 * s, min: 8 * s },
      measure,
    );
    y += 2 * s + mm(second.sizePt) * ASCENT;
    texts.push({ ...second, x: cx, y, font: "display", tone: "detail" });
  }

  const qrSize = (content.secondary ? 52 : 58) * s;
  y += 6 * s;
  const qr = { x: cx - qrSize / 2, y, size: qrSize };
  y += qrSize + 4 * s;

  const block = (
    text: string,
    font: SignFont,
    sizes: { max: number; min: number },
    tone: SignTone,
  ) => {
    const fitted = wrapFit(text, font, maxWidth, sizes, 3, measure);
    for (const line of fitted.lines) {
      y += mm(fitted.sizePt) * LINE;
      texts.push({ text: line, x: cx, y, sizePt: fitted.sizePt, font, tone });
    }
  };
  block(content.instruction, "sans", { max: 9.5 * s, min: 7 * s }, "name");
  if (content.secondary) {
    y += 1.5 * s;
    block(content.secondary.instruction, "sans", { max: 8 * s, min: 6.5 * s }, "detail");
  }

  if (content.url) {
    const url = fitLine(content.url, "sans", maxWidth, { max: 7 * s, min: 5.5 * s }, measure);
    // adresa drží u spodního okraje, pokud nad ní zbývá místo
    const bottom = height - 8 * s;
    y = Math.max(y + 4 * s, Math.min(bottom, height - 4 * s));
    texts.push({ ...url, x: cx, y, font: "sans", tone: "detail" });
  }

  return { width, height, texts, ornament, qr };
}
