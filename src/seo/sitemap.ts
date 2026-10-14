import { locales } from "@/i18n/config";
import { languageUrls, type PageRef, type RouteName } from "@/i18n/pathnames";

/**
 * Stránky v mapě webu (úvodní web, právní podstránky a blog). Weby párů, průvodce a správa v mapě nejsou.
 */
export const indexableRoutes: readonly RouteName[] = [
  "home",
  "pricing",
  "templates",
  "bilingual",
  "rsvp",
  "seating",
  "photographers",
  "blog",
  "privacy",
  "terms",
  "accessibility",
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * `sitemap.xml` úvodní stránky: každá jazyková verze je samostatný záznam
 * a nese všechny alternativy (`xhtml:link`). Weby párů, průvodce a správa v mapě nejsou.
 * `pages` jsou stránky z tabulky cest nebo adresy článků blogu (`articlePaths`).
 * `lastmod` (RRRR-MM-DD) se uvádí jen u stránek, které ho v mapě mají; u ostatních by nebyl pravdivý.
 */
export function buildSitemap(
  siteUrl: string,
  pages: readonly PageRef[] = indexableRoutes,
  lastmod: ReadonlyMap<PageRef, string> = new Map(),
): string {
  const entries: string[] = [];
  for (const page of pages) {
    const urls = languageUrls(page, siteUrl);
    const alternates = Object.entries(urls)
      .map(
        ([hreflang, href]) =>
          `    <xhtml:link rel="alternate" hreflang="${escapeXml(hreflang)}" href="${escapeXml(href)}" />`,
      )
      .join("\n");
    const mod = lastmod.get(page);
    const modTag = mod ? `    <lastmod>${escapeXml(mod)}</lastmod>\n` : "";
    for (const locale of locales) {
      entries.push(
        `  <url>\n    <loc>${escapeXml(urls[locale])}</loc>\n${modTag}${alternates}\n  </url>`,
      );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`;
}
