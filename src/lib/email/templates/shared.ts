import { htmlLang, intlLocale, type Locale } from "@/i18n/config";
import { formatPause } from "@/i18n/duration";
import { typo } from "@/i18n/typo";

export { formatPause };

/**
 * Společné části šablon e-mailů (docs/adr/0005-email.md): vlastní TypeScript, žádná externí
 * šablonovací služba, žádný zdroj třetí strany, žádné sledovací pixely ani přesměrování odkazů.
 * Každý text (i dosazené hodnoty) prochází `typo()`.
 */

export type RenderedEmail = {
  subject: string;
  /** Prostý text: kód a odkaz na samostatných řádcích, aby šly vložit ze schránky. */
  text: string;
  html: string;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Barvy z design tokenů (`src/app/globals.css`); e-mail nemůže použít CSS proměnné. */
const COLORS = {
  background: "#f7f4ed",
  card: "#efebe1",
  ink: "#1b2a23",
  pine: "#365c4e",
  muted: "#4b5a52",
} as const;

export type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "small"; text: string };

const FONT = "Arial, Helvetica, sans-serif";

function htmlBlock(block: Block): string {
  switch (block.kind) {
    case "heading":
      return `<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;color:${COLORS.ink};font-weight:normal">${escapeHtml(block.text)}</h1>`;
    case "paragraph":
      return `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:${COLORS.ink}">${escapeHtml(block.text)}</p>`;
    case "code":
      return `<p style="margin:0 0 16px;font-size:32px;line-height:1.3;letter-spacing:4px;font-weight:bold;color:${COLORS.ink}">${escapeHtml(block.text)}</p>`;
    case "link":
      // Text odkazu popisuje cíl; adresa je v textové verzi i viditelně pod tlačítkem.
      return `<p style="margin:0 0 16px;font-size:16px;line-height:1.5"><a href="${escapeHtml(block.href)}" style="display:inline-block;padding:12px 20px;background:${COLORS.pine};color:${COLORS.background};text-decoration:underline;border-radius:10px">${escapeHtml(block.text)}</a></p>`;
    case "small":
      return `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:${COLORS.muted}">${escapeHtml(block.text)}</p>`;
  }
}

function textBlock(block: Block): string {
  switch (block.kind) {
    case "heading":
      return block.text.toUpperCase();
    case "link":
      return `${block.text}:\n${block.href}`;
    default:
      return block.text;
  }
}

/** Složí e-mail z bloků: text i HTML vznikají ze stejných dat, takže se nemohou rozejít. */
export function composeEmail(
  locale: Locale,
  subject: string,
  blocks: readonly Block[],
  brand: string,
): RenderedEmail {
  // Typografie jen na texty; adresa odkazu se nikdy neupravuje.
  const typed = blocks.map((block): Block => ({ ...block, text: typo(block.text, locale) }));
  const typedSubject = typo(subject, locale);
  const typedBrand = typo(brand, locale);

  const text = [...typed.map(textBlock), `-- \n${typedBrand}`].join("\n\n") + "\n";
  const html = `<!doctype html>
<html lang="${htmlLang[locale]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(typedSubject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.background};font-family:${FONT}">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="padding:24px;background:${COLORS.card};border-radius:16px">
${typed.map(htmlBlock).join("\n")}
</div>
<p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:${COLORS.muted}">${escapeHtml(typedBrand)}</p>
</div>
</body>
</html>
`;
  return { subject: typedSubject, text, html };
}

/** Datum a čas v pražském čase ("2. října 2026 v 14:05"), s typografií. */
export function formatMoment(value: Date, locale: Locale): string {
  return typo(
    new Intl.DateTimeFormat(intlLocale[locale], {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Europe/Prague",
    }).format(value),
    locale,
  );
}
