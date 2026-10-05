import { articlePaths } from "@/blog/article";
import { publishedArticles } from "@/blog/store";
import type { PageRef } from "@/i18n/pathnames";
import { siteUrl } from "@/lib/site";
import { legalVersion } from "@/legal/meta";
import { buildSitemap, indexableRoutes } from "@/seo/sitemap";

// Články se čtou ze souborů při sestavení a po minutě znovu (ISR); po půlnoci mapu načte cron `/api/cron/blog`.
export const dynamic = "force-static";
export const revalidate = 60;

export function GET() {
  const articles = publishedArticles();
  const paths = articles.map(articlePaths);
  const lastmod = new Map<PageRef, string>(paths.map((p, i) => [p, articles[i].updatedAt]));
  for (const route of ["privacy", "terms", "accessibility"] as const)
    lastmod.set(route, legalVersion.effectiveFrom);
  return new Response(buildSitemap(siteUrl, [...indexableRoutes, ...paths], lastmod), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
