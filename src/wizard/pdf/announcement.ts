import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { intlLocale, type Locale } from "@/i18n/config";
import { typo } from "@/i18n/typo";
import { qrMatrix, QR_QUIET_ZONE } from "../qr";

/**
 * PDF oznámení k tisku (M5, FR-WZ-1, test E2E-07): adresa webu, QR kód a PIN hostů na jedné
 * stránce A4, aby šlo oznámení vložit k pozvánce.
 *
 * Knihovna: `pdf-lib` (MIT, čistý JavaScript bez nativních závislostí a bez prohlížeče), jen na
 * serveru, načítá se až v obsluze stahování. Důvod (docs/technical-design.md kap. 5): jednostránkové
 * oznámení potřebuje kresbu, ne rozvržení dokumentu, takže nestojí za `@react-pdf/renderer`
 * (vlastní rozvržení, React renderer, WebAssembly), a bez prohlížeče odpadá i tisk přes headless
 * Chromium. Písma značky (Newsreader a DM Sans, licence OFL) se vkládají jako podmnožiny, takže
 * česká diakritika vyjde správně. QR kód je vektorový, neztrácí ostrost při tisku.
 *
 * Omezení: `pdf-lib` neumí značkované (tagged) PDF. Dokument má titulek a jazyk, ale strukturu
 * pro čtečky obrazovky ne; stejné údaje jsou přístupně na obrazovce „Hotovo“ a PDF je tištěná
 * pomůcka. Vyhodnocení a případná výměna knihovny je v docs/technical-design.md.
 */

const A4 = { width: 595.28, height: 841.89 } as const;
const INK = rgb(0x1b / 255, 0x2a / 255, 0x23 / 255);
const PINE = rgb(0x36 / 255, 0x5c / 255, 0x4e / 255);
const MUTED = rgb(0x4b / 255, 0x5a / 255, 0x52 / 255);
const LINEN = rgb(0xd9 / 255, 0xe1 / 255, 0xd7 / 255);

const COPY = {
  cs: {
    title: "Oznámení svatebního webu",
    kicker: "Svatební web",
    lead: "Všechny informace najdete na našem webu:",
    scan: "Naskenujte kód telefonem, nebo opište adresu.",
    qrAlt: "QR kód s adresou webu",
    pinLabel: "PIN pro hosty",
    pinNote: "Některé údaje uvidíte až po zadání PINu.",
    footer: "Web vznikl na se-vezmou.cz",
    wedding: (date: string) => `Svatba ${date}`,
  },
  en: {
    title: "Wedding website announcement",
    kicker: "Wedding website",
    lead: "You will find all the details on our website:",
    scan: "Scan the code with your phone, or type the address.",
    qrAlt: "QR code with the website address",
    pinLabel: "Guest PIN",
    pinNote: "Some details are shown only after you enter the PIN.",
    footer: "Created at se-vezmou.cz",
    wedding: (date: string) => `Wedding on ${date}`,
  },
} as const;

type FontName = "DMSans_400Regular.ttf" | "DMSans_700Bold.ttf" | "Newsreader_500Medium.ttf";

const fontCache = new Map<FontName, Promise<Buffer>>();

/** Písma leží v repozitáři (`src/wizard/pdf/fonts`) a do nasazení je přidává `outputFileTracingIncludes`. */
function fontBytes(name: FontName): Promise<Buffer> {
  let bytes = fontCache.get(name);
  if (!bytes) {
    bytes = readFile(join(process.cwd(), "src/wizard/pdf/fonts", name));
    fontCache.set(name, bytes);
  }
  return bytes;
}

export interface AnnouncementInput {
  locale: Locale;
  partners: { a: string; b: string };
  /** `YYYY-MM-DD`, nepovinné. */
  startsOn: string | null;
  endsOn?: string | null;
  /** Adresa webu bez schématu, např. `klara-a-matej.se-vezmou.cz`. */
  host: string;
  /** Úplná adresa webu pro QR kód. */
  url: string;
  /** PIN hostů v prostém tvaru; bez něj se pole na stránce vynechá. */
  pin: string | null;
}

/** Text jen ze znaků, které písmo umí (nezlomitelná mezera a pomlčky by jinak shodily vložení). */
function printable(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...text]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (supported.has(code)) return char;
      if (code === 0xa0 || code === 0x202f) return " ";
      if (code === 0x2013 || code === 0x2014) return "-";
      return "?";
    })
    .join("");
}

function dayLabel(input: AnnouncementInput): string | null {
  if (!input.startsOn) return null;
  const format = (value: string) =>
    new Intl.DateTimeFormat(intlLocale[input.locale], {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));
  const first = format(input.startsOn);
  const last = input.endsOn && input.endsOn > input.startsOn ? format(input.endsOn) : null;
  return typo(last ? `${first} – ${last}` : first, input.locale);
}

function centered(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  y: number,
  color = INK,
  maxWidth = A4.width - 96,
): number {
  let fitted = size;
  while (font.widthOfTextAtSize(text, fitted) > maxWidth && fitted > 10) fitted -= 1;
  const width = font.widthOfTextAtSize(text, fitted);
  page.drawText(text, { x: (A4.width - width) / 2, y, size: fitted, font, color });
  return fitted;
}

/** Vektorový QR kód: vodorovné řady tmavých modulů se spojují do jednoho obdélníku. */
function drawQr(page: PDFPage, payload: string, x: number, y: number, size: number): void {
  const matrix = qrMatrix(payload);
  const total = matrix.count + QR_QUIET_ZONE * 2;
  const cell = size / total;
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
  matrix.dark.forEach((cells, row) => {
    let col = 0;
    while (col < cells.length) {
      if (!cells[col]) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < cells.length && cells[col]) col += 1;
      page.drawRectangle({
        x: x + (start + QR_QUIET_ZONE) * cell,
        y: y + size - (row + QR_QUIET_ZONE + 1) * cell,
        width: (col - start) * cell,
        height: cell + 0.2,
        color: rgb(0, 0, 0),
      });
    }
  });
}

/** Jednostránkové PDF s adresou, QR kódem a (volitelně) PINem. */
export async function renderAnnouncementPdf(input: AnnouncementInput): Promise<Uint8Array> {
  const copy = COPY[input.locale];
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const [serifBytes, sansBytes, boldBytes] = await Promise.all([
    fontBytes("Newsreader_500Medium.ttf"),
    fontBytes("DMSans_400Regular.ttf"),
    fontBytes("DMSans_700Bold.ttf"),
  ]);
  const serif = await pdf.embedFont(serifBytes, { subset: true });
  const sans = await pdf.embedFont(sansBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });

  const names = `${input.partners.a} & ${input.partners.b}`;
  pdf.setTitle(`${copy.title}: ${names}`);
  pdf.setAuthor("Se vezmou");
  pdf.setSubject(copy.title);
  pdf.setCreator("se-vezmou.cz");
  pdf.setProducer("se-vezmou.cz (pdf-lib)");
  pdf.setLanguage(intlLocale[input.locale]);
  pdf.setCreationDate(new Date());

  const page = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - 110;

  centered(page, printable(sans, typo(copy.kicker.toUpperCase(), input.locale)), sans, 13, y, PINE);
  y -= 70;
  centered(page, printable(serif, names), serif, 54, y);
  y -= 34;
  const date = dayLabel(input);
  if (date) {
    centered(page, printable(sans, copy.wedding(date)), sans, 17, y, MUTED);
    y -= 34;
  }

  page.drawLine({
    start: { x: A4.width / 2 - 40, y },
    end: { x: A4.width / 2 + 40, y },
    thickness: 1.2,
    color: PINE,
  });
  y -= 50;

  centered(page, printable(sans, typo(copy.lead, input.locale)), sans, 16, y);
  y -= 46;
  centered(page, printable(bold, input.host), bold, 26, y, INK);
  y -= 40;

  const qrSize = 230;
  drawQr(page, input.url, (A4.width - qrSize) / 2, y - qrSize, qrSize);
  y -= qrSize + 28;
  centered(page, printable(sans, typo(copy.scan, input.locale)), sans, 13, y, MUTED);
  y -= 50;

  if (input.pin) {
    const boxWidth = 300;
    const boxHeight = 96;
    page.drawRectangle({
      x: (A4.width - boxWidth) / 2,
      y: y - boxHeight,
      width: boxWidth,
      height: boxHeight,
      color: LINEN,
    });
    centered(page, printable(sans, copy.pinLabel), sans, 13, y - 26, MUTED);
    // PIN s mezerou mezi číslicemi: dobře se opisuje a čtečka (i člověk) ho přečte po číslicích
    centered(
      page,
      printable(bold, input.pin.split("").join(" ")),
      bold,
      34,
      y - 62,
      INK,
      boxWidth - 24,
    );
    y -= boxHeight + 22;
    centered(page, printable(sans, typo(copy.pinNote, input.locale)), sans, 12, y, MUTED);
  }

  centered(page, printable(sans, copy.footer), sans, 10, 50, MUTED);

  return pdf.save();
}
