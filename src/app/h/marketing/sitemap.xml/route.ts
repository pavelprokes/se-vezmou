import { articlePaths } from "@/blog/article";
import { publishedArticles } from "@/blog/store";
import { siteUrl } from "@/lib/site";
import { buildSitemap, indexableRoutes } from "@/seo/sitemap";

// Články se čtou ze souborů při sestavení; nový článek přijde s novým nasazením.
export const dynamic = "force-static";

export function GET() {
  const pages = [...indexableRoutes, ...publishedArticles().map(articlePaths)];
  return new Response(buildSitemap(siteUrl, pages), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
