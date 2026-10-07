import { articlePath } from "@/blog/article";
import { publishedArticles } from "@/blog/store";
import { operator } from "@/config/operator";
import { locales } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { localizedPath } from "@/i18n/pathnames";
import { siteUrl } from "@/lib/site";
import { FACT_KEYS } from "@/components/landing/facts-section";
import { buildLlmsTxt, type LlmsLink } from "@/seo/llms";

// Stejně jako mapa webu: ISR po minutě, naplánované články po půlnoci načte cron `/api/cron/blog`.
export const dynamic = "force-static";
export const revalidate = 60;

/** Stránky z mapy webu a klíč jejich titulku a popisu v překladech. */
const pages = [
  ["home", "marketing.home"],
  ["pricing", "marketing.pricing"],
  ["templates", "marketing.templates"],
  ["bilingual", "marketing.bilingual"],
  ["rsvp", "marketing.rsvp"],
  ["photographers", "marketing.photographers"],
  ["blog", "blog.index"],
] as const;

export async function GET() {
  const absolute = (path: string) => new URL(path, siteUrl).toString();
  const sections = [];
  const summary = [];
  const facts: string[] = [];
  for (const locale of locales) {
    const t = await getTranslator(locale, ["marketing", "blog"]);
    summary.push(t("marketing.home.metaDescription"));
    facts.push(
      `${locale === "cs" ? "Fakta" : "Facts"}: ` +
        FACT_KEYS.map((key) => t(`marketing.facts.${key}.value`)).join(" "),
    );
    const links: LlmsLink[] = pages.map(([route, key]) => ({
      title: t(`${key}.metaTitle`),
      url: absolute(localizedPath(route, locale)),
      description: t(`${key}.metaDescription`),
    }));
    for (const article of publishedArticles()) {
      const text = article.translations[locale];
      links.push({
        title: text.title,
        url: absolute(articlePath(article, locale)),
        description: text.description,
      });
    }
    sections.push({ heading: locale === "cs" ? "Česky" : "English", links });
  }
  const body = buildLlmsTxt({
    name: "Se vezmou (se-vezmou.cz)",
    summary,
    details: [
      ...facts,
      `Provozovatel / Operator: ${operator.nameAndId}, ${operator.address}. Kontakt / Contact: ${operator.contact}.`,
      "Weby párů (jmeno-a-jmeno.se-vezmou.cz) jsou soukromé a vyhledávače je neindexují. / Couples' websites are private and not indexed.",
    ],
    sections,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
