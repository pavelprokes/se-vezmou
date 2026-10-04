import { isLocale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { findPublishedBySlug } from "@/blog/store";
import { ogCard } from "@/seo/og-card";

/**
 * Obrázek pro sdílení článku blogu (`/og/blog/<slug>`, `/en/og/blog/<slug>`): název článku v barvách
 * značky. Jen zveřejněné články; naplánovaný nebo neexistující článek je 404.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/h/marketing/[locale]/og/blog/[slug]">,
) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return new Response(null, { status: 404 });
  const article = findPublishedBySlug(locale, slug);
  if (!article) return new Response(null, { status: 404 });
  const t = await getTranslator(locale, ["common", "blog"]);
  return ogCard({
    eyebrow: t("blog.index.eyebrow"),
    title: article.translations[locale].title,
    footer: `se-vezmou.cz · ${t("common.brand")}`,
    // tokeny značky z src/app/globals.css (pergamen, inkoust, skořice)
    colors: {
      bg: "#f7f4ed",
      text: "#1b2a23",
      accent: "#8e503c",
      muted: "#365c4e",
      rule: "#d9e1d7",
    },
    serif: true,
  });
}
