import "server-only";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { cleanWith, color, loadFontkit, measureWith, NAME_FONT } from "@/admin/name-cards/pdf";
import { MARK } from "@/admin/name-cards/layout";
import { ORNAMENTS, type CardStyle } from "@/admin/name-cards/style";
import { intlLocale, type Locale } from "@/i18n/config";
import { drawQr, fontBytes, printable, type FontName } from "@/wizard/pdf/announcement";
import {
  signCropMarks,
  signLayout,
  signPage,
  signRects,
  type GallerySignFormat,
  type SignContent,
  type SignFont,
  type SignLayout,
  type SignMeasure,
  type SignTone,
} from "./layout";

/**
 * PDF cedulky s QR kódem galerie (A4, skutečná velikost, ořezové značky vně). Písma, barvy
 * a dekor šablony jako u jmenovek (`cardStyle`), papír bílý. QR je vektorový.
 */

const MM = 72 / 25.4;

function fontFile(font: SignFont, style: CardStyle): FontName {
  if (font === "display") return NAME_FONT[style.font];
  return font === "bold" ? "DMSans_700Bold.ttf" : "DMSans_400Regular.ttf";
}

/** Měření a čištění textu metrikami skutečných písem (náhled i PDF používají totéž). */
export async function signMetrics(style: CardStyle): Promise<{
  measure: SignMeasure;
  clean: (font: SignFont, text: string) => string;
}> {
  const fonts: SignFont[] = ["display", "sans", "bold"];
  const faces = await Promise.all(fonts.map((font) => loadFontkit(fontFile(font, style))));
  const byFont = new Map(fonts.map((font, index) => [font, faces[index]]));
  return {
    measure: (text, font, sizePt) => {
      const face = byFont.get(font)!;
      return measureWith(face)(cleanWith(face)(text), sizePt);
    },
    clean: (font, text) => cleanWith(byFont.get(font)!)(text),
  };
}

/** Rozvržení s textem očištěným na znaky písem (co je v náhledu, to se vytiskne). */
export async function gallerySignLayout(
  format: GallerySignFormat,
  content: SignContent,
  style: CardStyle,
): Promise<SignLayout> {
  const { measure } = await signMetrics(style);
  return signLayout(format, content, style, measure);
}

export function toneColor(style: CardStyle, tone: SignTone): string {
  if (tone === "name") return style.name;
  if (tone === "accent") return style.ornamentColor;
  return style.detail;
}

function drawSign(
  page: PDFPage,
  pageHeight: number,
  layout: SignLayout,
  origin: { x: number; y: number },
  style: CardStyle,
  qrUrl: string,
  fonts: Record<SignFont, PDFFont>,
) {
  const at = (x: number, y: number) => ({
    x: (origin.x + x) * MM,
    y: pageHeight - (origin.y + y) * MM,
  });

  const ornament = ORNAMENTS[style.ornament];
  const ornamentColor = color(style.ornamentColor);
  for (const path of ornament.paths) {
    page.drawSvgPath(path.d, {
      ...at(layout.ornament.x, layout.ornament.y),
      scale: MM * layout.ornament.scale,
      ...(path.mode === "fill"
        ? { color: ornamentColor }
        : {
            borderColor: ornamentColor,
            borderWidth: (path.strokeWidth ?? 0.2) * layout.ornament.scale,
          }),
    });
  }

  for (const line of layout.texts) {
    const font = fonts[line.font];
    const text = printable(font, line.text);
    const width = font.widthOfTextAtSize(text, line.sizePt) / MM;
    page.drawText(text, {
      ...at(line.x - width / 2, line.y),
      size: line.sizePt,
      font,
      color: color(toneColor(style, line.tone)),
    });
  }

  const qrBottom = at(layout.qr.x, layout.qr.y + layout.qr.size);
  drawQr(page, qrUrl, qrBottom.x, qrBottom.y, layout.qr.size * MM);
}

export interface GallerySignPdfInput {
  locale: Locale;
  format: GallerySignFormat;
  content: SignContent;
  style: CardStyle;
  qrUrl: string;
  title: string;
}

export async function renderGallerySignPdf(input: GallerySignPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontNames: SignFont[] = ["display", "sans", "bold"];
  const embedded = await Promise.all(
    fontNames.map(async (font) =>
      pdf.embedFont(await fontBytes(fontFile(font, input.style)), { subset: true }),
    ),
  );
  const fonts = Object.fromEntries(fontNames.map((font, i) => [font, embedded[i]])) as Record<
    SignFont,
    PDFFont
  >;
  pdf.setTitle(input.title);
  pdf.setLanguage(intlLocale[input.locale]);
  pdf.setCreator("se-vezmou.cz");
  pdf.setProducer("se-vezmou.cz");

  const layout = await gallerySignLayout(input.format, input.content, input.style);
  const pageSize = signPage(input.format);
  const page = pdf.addPage([pageSize.width * MM, pageSize.height * MM]);
  const pageHeight = pageSize.height * MM;
  for (const rect of signRects(input.format)) {
    drawSign(page, pageHeight, layout, rect, input.style, input.qrUrl, fonts);
  }
  for (const mark of signCropMarks(input.format)) {
    page.drawLine({
      start: { x: mark.x1 * MM, y: pageHeight - mark.y1 * MM },
      end: { x: mark.x2 * MM, y: pageHeight - mark.y2 * MM },
      thickness: MARK.weightPt,
      color: rgb(0, 0, 0),
    });
  }
  return pdf.save();
}
