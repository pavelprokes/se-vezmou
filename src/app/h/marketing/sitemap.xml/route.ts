import { articlePaths } from "@/blog/article";
import { publishedArticles } from "@/blog/store";
import { siteUrl } from "@/lib/site";
import { buildSitemap, indexableRoutes } from "@/seo/sitemap";

// Články se čtou ze souborů při sestavení a jednou za hodinu znovu (naplánované zveřejnění).
export const dynamic = "force-static";
export const revalidate = 3600;

export function GET() {
  const pages = [...indexableRoutes, ...publishedArticles().map(articlePaths)];
  return new Response(buildSitemap(siteUrl, pages), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
