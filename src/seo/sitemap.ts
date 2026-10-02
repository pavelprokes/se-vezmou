import { locales } from "@/i18n/config";
import { languageUrls, pathnames, type RouteName } from "@/i18n/pathnames";

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
 */
export function buildSitemap(siteUrl: string, routes?: readonly RouteName[]): string {
  const names = routes ?? (Object.keys(pathnames) as RouteName[]);
  const entries: string[] = [];
  for (const route of names) {
    const urls = languageUrls(route, siteUrl);
    const alternates = Object.entries(urls)
      .map(
        ([hreflang, href]) =>
          `    <xhtml:link rel="alternate" hreflang="${escapeXml(hreflang)}" href="${escapeXml(href)}" />`,
      )
      .join("\n");
    for (const locale of locales) {
      entries.push(`  <url>\n    <loc>${escapeXml(urls[locale])}</loc>\n${alternates}\n  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`;
}
