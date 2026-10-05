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
export const DETAIL_SIZE_PT = 7.5;

export interface FaceLayout {
  width: number;
  height: number;
  sizePt: number;
  /** Řádky jména: střed `x` a účaří `y`. */
  lines: { text: string; x: number; y: number }[];
  ornament: { x: number; y: number };
  detail: { text: string; x: number; y: number } | null;
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
  measure: (text: string, sizePt: number) => number,
): FaceLayout {
  const { width, height } = faceSize(format);
  const fitted = fitName(name, width - 2 * PAD_X, measure);
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
    width,
    height,
    sizePt: fitted.sizePt,
    lines: fitted.lines.map((text, index) => ({
      text,
      x: center,
      y: blockTop + index * lineHeight + (lineHeight - sizeMm) / 2 + sizeMm * ASCENT,
    })),
    ornament: { x: center - ornament.width / 2, y: ornamentTop },
    detail: detail ? { text: detail, x: center, y: height - 5.5 } : null,
  };
}
