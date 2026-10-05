import { FORMATS, fitName, type NameCardFormat } from "./layout";
import { ORNAMENTS, type CardStyle } from "./style";

/**
 * Rozvržení jedné strany jmenovky v milimetrech (počátek vlevo nahoře, osa y dolů). Stejná čísla
 * kreslí náhled ve správě (SVG) i PDF, takže se náhled a tisk neliší.
 */

export const PT_TO_MM = 25.4 / 72;
const PAD_X = 7;
const LINE_HEIGHT = 1.18;
const ASCENT = 0.9;
const GAP = 2.5;
export const DETAIL_SIZE = { max: 7.5, min: 6 } as const;

export type Measure = (text: string, sizePt: number) => number;

/** Měření jména (písmo šablony) a drobného řádku (DM Sans). */
export interface FaceMetrics {
  name: Measure;
  detail: Measure;
}

export interface FaceLayout {
  /** Jméno tak, jak se vytiskne (očištěné na znaky písma). */
  name: string;
  width: number;
  height: number;
  sizePt: number;
  /** Řádky jména: střed `x` a účaří `y`. */
  lines: { text: string; x: number; y: number }[];
  ornament: { x: number; y: number };
  detail: { text: string; x: number; y: number; sizePt: number } | null;
}

/** Drobný řádek do šířky: zmenšit až na 6 pt, pak zkrátit se třemi tečkami. */
export function fitDetail(text: string, maxWidth: number, measure: Measure) {
  for (let size: number = DETAIL_SIZE.max; size >= DETAIL_SIZE.min; size -= 0.5) {
    if (measure(text, size) <= maxWidth) return { text, sizePt: size };
  }
  let cut = text;
  while (cut.length > 1 && measure(`${cut}…`, DETAIL_SIZE.min) > maxWidth) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}…`, sizePt: DETAIL_SIZE.min };
}

/**
 * Bod strany karty (mm, osa y dolů) na listu (mm, osa y dolů). Zadní strana stojánku je otočená
 * o 180° kolem středu strany: bod se zrcadlí na `(šířka − x, výška − y)`.
 */
export function facePoint(
  face: { width: number; height: number },
  origin: { x: number; y: number },
  flipped: boolean,
  x: number,
  y: number,
) {
  return {
    x: origin.x + (flipped ? face.width - x : x),
    y: origin.y + (flipped ? face.height - y : y),
  };
}

/** Rozměr jedné strany: plochá celá karta, stojánek polovina rozložené karty. */
export function faceSize(format: NameCardFormat): { width: number; height: number } {
  const spec = FORMATS[format];
  return { width: spec.width, height: spec.fold ? spec.height / 2 : spec.height };
}

export function faceLayout(
  name: string,
  detail: string | null,
  style: CardStyle,
  format: NameCardFormat,
  metrics: FaceMetrics,
): FaceLayout {
  const { width, height } = faceSize(format);
  const fitted = fitName(name, width - 2 * PAD_X, metrics.name);
  const sizeMm = fitted.sizePt * PT_TO_MM;
  const lineHeight = sizeMm * LINE_HEIGHT;
  const blockHeight = fitted.lines.length * lineHeight;
  const ornament = ORNAMENTS[style.ornament];
  const groupHeight = blockHeight + GAP + ornament.height;

  const areaTop = 4;
  const areaBottom = detail ? height - 10 : height - 4;
  const groupTop = areaTop + (areaBottom - areaTop - groupHeight) / 2;
  const ornamentAbove = style.ornament === "bar";
  const blockTop = ornamentAbove ? groupTop + ornament.height + GAP : groupTop;
  const ornamentTop = ornamentAbove ? groupTop : groupTop + blockHeight + GAP;
  const center = width / 2;

  return {
    name,
    width,
    height,
    sizePt: fitted.sizePt,
    lines: fitted.lines.map((text, index) => ({
      text,
      x: center,
      y: blockTop + index * lineHeight + (lineHeight - sizeMm) / 2 + sizeMm * ASCENT,
    })),
    ornament: { x: center - ornament.width / 2, y: ornamentTop },
    detail: detail
      ? { ...fitDetail(detail, width - 2 * PAD_X, metrics.detail), x: center, y: height - 5.5 }
      : null,
  };
}
