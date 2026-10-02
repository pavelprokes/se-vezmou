import { siteUrl } from "@/lib/site";
import { buildSitemap } from "@/seo/sitemap";

export function GET() {
  return new Response(buildSitemap(siteUrl), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
