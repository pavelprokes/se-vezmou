import "server-only";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, degrees, rgb, type Color, type PDFFont, type PDFPage } from "pdf-lib";
import { intlLocale, type Locale } from "@/i18n/config";
import { parseColor } from "@/design/contrast";
import { fontBytes, printable, type FontName } from "@/wizard/pdf/announcement";
import { PT_TO_MM, faceLayout, facePoint, type FaceLayout, type Measure } from "./face";
import {
  A4_MM,
  FORMATS,
  MARK,
  cardRects,
  cropMarks,
  foldMarks,
  paginate,
  type NameCardFormat,
  type Rect,
} from "./layout";
import { ORNAMENTS, type CardFont, type CardStyle } from "./style";

/**
 * PDF jmenovek k tisku na A4 (bez škálování, „skutečná velikost“): karty těsně vedle sebe,
 * ořezové značky vně mřížky, u stojánku značky přehybu a zadní strana otočená o 180°, aby jméno
 * bylo vidět z obou stran stolu. Písma a vektorový dekor jako v PDF oznámení (`pdf-lib`).
 */

const MM = 72 / 25.4;
const PAGE = { width: A4_MM.width * MM, height: A4_MM.height * MM };
const MARK_COLOR = rgb(0, 0, 0);

const NAME_FONT: Record<CardFont, FontName> = {
  serif: "Newsreader_500Medium.ttf",
  sans: "DMSans_700Bold.ttf",
};
const DETAIL_FONT: FontName = "DMSans_400Regular.ttf";

type FontkitFont = ReturnType<typeof fontkit.create>;
const fontkitCache = new Map<FontName, Promise<FontkitFont>>();

function loadFontkit(name: FontName): Promise<FontkitFont> {
  let loaded = fontkitCache.get(name);
  if (!loaded) {
    loaded = fontBytes(name).then((bytes) => fontkit.create(new Uint8Array(bytes)));
    fontkitCache.set(name, loaded);
  }
  return loaded;
}

function measureWith(face: FontkitFont): Measure {
  return (text, sizePt) => (face.layout(text).advanceWidth / face.unitsPerEm) * sizePt * PT_TO_MM;
}

/**
 * Text jen ze znaků, které písmo umí: nezlomitelná mezera na mezeru, pomlčky na spojovník, ostatní
 * (emoji, cizí písma) vypustit. Jména se předem skládají do NFC (č jako jeden znak, ne c + háček).
 */
function cleanWith(face: FontkitFont): (text: string) => string {
  return (text) =>
    [...text.normalize("NFC")]
      .map((char) => {
        const code = char.codePointAt(0) ?? 0;
        if (code === 0xa0 || code === 0x202f) return " ";
        if (code === 0x2013 || code === 0x2014) return "-";
        return face.hasGlyphForCodePoint(code) ? char : "";
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
}

/**
 * Rozvržení všech jmenovek (náhled i PDF): texty očištěné na znaky písem a změřené jejich metrikami,
 * takže náhled ukazuje přesně to, co se vytiskne. Jméno, ze kterého nic nezbude, se vynechá.
 */
export async function cardFaces(
  names: readonly string[],
  detail: string | null,
  style: CardStyle,
  format: NameCardFormat,
): Promise<FaceLayout[]> {
  const [nameFont, detailFont] = await Promise.all([
    loadFontkit(NAME_FONT[style.font]),
    loadFontkit(DETAIL_FONT),
  ]);
  const metrics = { name: measureWith(nameFont), detail: measureWith(detailFont) };
  const cleanName = cleanWith(nameFont);
  const line = detail ? cleanWith(detailFont)(detail) : "";
  return names
    .map(cleanName)
    .filter((name) => name !== "")
    .map((name) => faceLayout(name, line || null, style, format, metrics));
}

function color(hex: string): Color {
  const { r, g, b } = parseColor(hex);
  return rgb(r / 255, g / 255, b / 255);
}

export interface NameCardsInput {
  /** Jazyk dokumentu (jazyk webu páru, ve kterém je i datum). */
  locale: Locale;
  faces: readonly FaceLayout[];
  format: NameCardFormat;
  style: CardStyle;
  title: string;
}

/** Jedna strana karty; `flipped` = otočená o 180° kolem středu strany (zadní strana stojánku). */
function drawFace(
  page: PDFPage,
  face: FaceLayout,
  origin: { x: number; y: number },
  flipped: boolean,
  style: CardStyle,
  fonts: { name: PDFFont; detail: PDFFont },
) {
  // bod strany (mm, y dolů) → bod stránky (pt, y nahoru)
  const at = (x: number, y: number) => {
    const point = facePoint(face, origin, flipped, x, y);
    return { x: point.x * MM, y: PAGE.height - point.y * MM };
  };
  const rotate = degrees(flipped ? 180 : 0);
  const nameColor = color(style.name);

  for (const line of face.lines) {
    const text = printable(fonts.name, line.text);
    const width = fonts.name.widthOfTextAtSize(text, face.sizePt) / MM;
    page.drawText(text, {
      ...at(line.x - width / 2, line.y),
      size: face.sizePt,
      font: fonts.name,
      color: nameColor,
      rotate,
    });
  }

  const ornament = ORNAMENTS[style.ornament];
  const ornamentColor = color(style.ornamentColor);
  for (const path of ornament.paths) {
    page.drawSvgPath(path.d, {
      ...at(face.ornament.x, face.ornament.y),
      scale: MM,
      rotate,
      ...(path.mode === "fill"
        ? { color: ornamentColor }
        : { borderColor: ornamentColor, borderWidth: path.strokeWidth ?? 0.2 }),
    });
  }

  if (face.detail) {
    const text = printable(fonts.detail, face.detail.text);
    const width = fonts.detail.widthOfTextAtSize(text, face.detail.sizePt) / MM;
    page.drawText(text, {
      ...at(face.detail.x - width / 2, face.detail.y),
      size: face.detail.sizePt,
      font: fonts.detail,
      color: color(style.detail),
      rotate,
    });
  }
}

function drawMarks(page: PDFPage, format: NameCardFormat) {
  for (const mark of [...cropMarks(format), ...foldMarks(format)]) {
    page.drawLine({
      start: { x: mark.x1 * MM, y: PAGE.height - mark.y1 * MM },
      end: { x: mark.x2 * MM, y: PAGE.height - mark.y2 * MM },
      thickness: MARK.weightPt,
      color: MARK_COLOR,
    });
  }
}

export async function renderNameCardsPdf(input: NameCardsInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [nameBytes, detailBytes] = await Promise.all([
    fontBytes(NAME_FONT[input.style.font]),
    fontBytes(DETAIL_FONT),
  ]);
  const fonts = {
    name: await pdf.embedFont(nameBytes, { subset: true }),
    detail: await pdf.embedFont(detailBytes, { subset: true }),
  };
  pdf.setTitle(input.title);
  pdf.setLanguage(intlLocale[input.locale]);
  pdf.setCreator("se-vezmou.cz");
  pdf.setProducer("se-vezmou.cz");

  const spec = FORMATS[input.format];
  const rects = cardRects(input.format);
  for (const sheet of paginate(input.faces, input.format)) {
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    sheet.forEach((face, index) => {
      const rect: Rect = rects[index];
      if (spec.fold) {
        // spodní polovina je přední strana, horní (za přehybem) zadní, otočená
        drawFace(page, face, { x: rect.x, y: rect.y + face.height }, false, input.style, fonts);
        drawFace(page, face, { x: rect.x, y: rect.y }, true, input.style, fonts);
      } else {
        drawFace(page, face, { x: rect.x, y: rect.y }, false, input.style, fonts);
      }
    });
    drawMarks(page, input.format);
  }
  return pdf.save();
}
