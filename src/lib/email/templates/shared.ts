import { htmlLang, intlLocale, type Locale } from "@/i18n/config";
import { formatPause } from "@/i18n/duration";
import { authorProjects, operator, projectUrl } from "@/config/operator";
import { typo } from "@/i18n/typo";
import { env } from "@/env";
import { LOGO_PNG_BASE64 } from "../logo-data";

export { formatPause };

/**
 * Společné části šablon e-mailů (docs/adr/0005-email.md): vlastní TypeScript, žádná externí
 * šablonovací služba, žádný zdroj třetí strany, žádné sledovací pixely ani přesměrování odkazů.
 * Každý text (i dosazené hodnoty) prochází `typo()`.
 */

/** Obrázek vložený do zprávy přes Content-ID (`<img src="cid:...">`), ne vzdálený odkaz. */
export type InlineImage = { cid: string; contentType: string; content: Uint8Array };

export const LOGO_CID = "logo@se-vezmou.cz";

const logoImage: InlineImage = {
  cid: LOGO_CID,
  contentType: "image/png",
  content: Buffer.from(LOGO_PNG_BASE64, "base64"),
};

export type RenderedEmail = {
  subject: string;
  /** Vložené obrázky (logo); doprava je přibalí k zprávě. */
  inline?: InlineImage[];
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
  line: "#d9e1d7",
} as const;

export type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "small"; text: string }
  /** Nadpis seznamu a položky pod ním (potvrzení účasti: kdo přijde na kterou událost). */
  | { kind: "list"; text: string; items: string[] };

const FONT = "Arial, Helvetica, sans-serif";

function htmlBlock(block: Block): string {
  switch (block.kind) {
    case "heading":
      return `<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;color:${COLORS.ink};font-weight:normal">${escapeHtml(block.text)}</h1>`;
    case "paragraph":
      return `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:${COLORS.ink}">${escapeHtml(block.text)}</p>`;
    case "code":
      // Kód je živý text na jednom řádku (jde označit a zkopírovat), jen vizuálně jako karta.
      return `<p style="margin:0 0 16px"><span style="display:inline-block;padding:14px 22px;background:#ffffff;border:1px solid ${COLORS.line};border-radius:12px;font-size:32px;line-height:1.2;letter-spacing:6px;font-weight:bold;color:${COLORS.ink}">${escapeHtml(block.text)}</span></p>`;
    case "link":
      // Text odkazu popisuje cíl; adresa je v textové verzi i viditelně pod tlačítkem.
      return `<p style="margin:0 0 16px;font-size:16px;line-height:1.5"><a href="${escapeHtml(block.href)}" style="display:inline-block;padding:12px 20px;background:${COLORS.pine};color:${COLORS.background};text-decoration:underline;border-radius:10px">${escapeHtml(block.text)}</a></p>`;
    case "small":
      return `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:${COLORS.muted}">${escapeHtml(block.text)}</p>`;
    case "list":
      return `<p style="margin:0 0 4px;font-size:16px;line-height:1.5;color:${COLORS.ink};font-weight:bold">${escapeHtml(block.text)}</p>
<ul style="margin:0 0 16px;padding-left:20px;font-size:16px;line-height:1.5;color:${COLORS.ink}">${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }
}

function textBlock(block: Block): string {
  switch (block.kind) {
    case "heading":
      return block.text.toUpperCase();
    case "link":
      return `${block.text}:\n${block.href}`;
    case "list":
      return [block.text, ...block.items.map((item) => `- ${item}`)].join("\n");
    default:
      return block.text;
  }
}

const FOOTER = {
  cs: {
    contact: "Kontakt",
    projects: "Další projekty autora",
    site: "Svatební fotograf: ukázky práce a kontakt.",
    photos: "Sdílená galerie pro hosty a finální galerie od fotografa.",
  },
  en: {
    contact: "Contact",
    projects: "More projects by the author",
    site: "Wedding photographer: samples of work and contact.",
    photos: "A shared gallery for guests and the photographer’s final gallery.",
  },
} as const;

/** Patička každého e-mailu: kontakt a dva projekty autora s popisem a odkazem (UTM značky, bez sledování). */
function footer(locale: Locale, brand: string) {
  const copy = FOOTER[locale];
  const projects = authorProjects.map(({ key, host }) => ({
    host,
    description: typo(copy[key], locale),
    href: projectUrl(host, "email", "paticka-emailu"),
  }));
  const text = [
    `${copy.contact}: ${operator.contact}`,
    `${copy.projects}:`,
    ...projects.map((p) => `- ${p.host}: ${p.description}\n  ${p.href}`),
  ].join("\n");
  const html = `<!--footer--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;border-top:1px solid ${COLORS.line}">
<tr><td style="padding-top:20px;font-family:${FONT};font-size:13px;line-height:1.5;color:${COLORS.muted}">
<p style="margin:0 0 4px;color:${COLORS.ink};font-weight:bold">${escapeHtml(brand)}</p>
<p style="margin:0 0 16px">${escapeHtml(copy.contact)}: <a href="mailto:${escapeHtml(operator.contact)}" style="color:${COLORS.pine}">${escapeHtml(operator.contact)}</a></p>
<p style="margin:0 0 8px;font-size:11px;letter-spacing:1px;text-transform:uppercase">${escapeHtml(copy.projects)}</p>
${projects.map((p) => `<p style="margin:0 0 10px"><a href="${escapeHtml(p.href)}" style="color:${COLORS.pine};font-weight:bold">${escapeHtml(p.host)}</a><br>${escapeHtml(p.description)}</p>`).join("\n")}
</td></tr></table><!--/footer-->`;
  return { text, html };
}

/** Složí e-mail z bloků: text i HTML vznikají ze stejných dat, takže se nemohou rozejít. */
export function composeEmail(
  locale: Locale,
  subject: string,
  blocks: readonly Block[],
  brand: string,
): RenderedEmail {
  // Typografie jen na texty; adresa odkazu se nikdy neupravuje.
  const typed = blocks.map((block): Block =>
    block.kind === "list"
      ? {
          ...block,
          text: typo(block.text, locale),
          items: block.items.map((item) => typo(item, locale)),
        }
      : { ...block, text: typo(block.text, locale) },
  );
  const typedSubject = typo(subject, locale);
  const typedBrand = typo(brand, locale);

  const extra = footer(locale, typedBrand);
  const siteUrl = (env.NEXT_PUBLIC_SITE_URL ?? "https://se-vezmou.cz").replace(/\/+$/, "");
  const text = [...typed.map(textBlock), `-- \n${typedBrand}`, extra.text].join("\n\n") + "\n";
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
<!--logo--><p style="margin:0 0 20px"><a href="${siteUrl}/"><img src="cid:${LOGO_CID}" width="240" height="65" alt="se-vezmou.cz" style="display:block;border:0;width:240px;height:auto"></a></p><!--/logo-->
<div style="padding:24px;background:${COLORS.card};border-radius:16px">
${typed.map(htmlBlock).join("\n")}
</div>
${extra.html}
</div>
</body>
</html>
`;
  return { subject: typedSubject, inline: [logoImage], text, html };
}

/** Kalendářní den okamžiku v zadaném pásmu ("12. července 2027"), s typografií. */
export function formatEventDay(value: Date, locale: Locale, timeZone: string): string {
  return typo(
    new Intl.DateTimeFormat(intlLocale[locale], { dateStyle: "long", timeZone }).format(value),
    locale,
  );
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
