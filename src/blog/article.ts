import { z } from "zod";
import { locales, type Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/pathnames";

/**
 * Článek blogu na úvodní stránce. Každý článek je jeden soubor `content/blog/<id>.json` se všemi
 * jazykovými verzemi, takže překlady drží pohromadě a `hreflang` se páruje bez hledání.
 * Schéma je jediný zdroj pravdy: kontroluje soubory při sestavení, v testu i v administraci.
 */

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug: malá písmena, číslice a pomlčky");

export const articleTranslationSchema = z.object({
  /** Část adresy za `/blog/`, v každém jazyce vlastní (`svatebni-web`, `wedding-website`). */
  slug,
  /** Nadpis `<h1>` i `<title>` (k němu se připojí „| Se vezmou“), proto nejvýš 70 znaků. */
  title: z.string().trim().min(10).max(70),
  /** Meta description a perex pod nadpisem: 70 až 170 znaků. */
  description: z.string().trim().min(70).max(170),
  /**
   * Text článku v jednoduchém zápisu (`src/blog/markdown.ts`): odstavce oddělené prázdným řádkem,
   * `## ` a `### ` nadpisy, `- ` a `1. ` seznamy, `> ` tip, uvnitř `**tučně**` a `[odkaz](/cesta)`.
   */
  body: z.string().trim().min(200),
});

export const articleSchema = z.object({
  /** Stálý identifikátor a název souboru; nemění se ani při změně adres. */
  id: slug,
  /** Koncept se nikde nezobrazí (ani v mapě webu), vidí ho jen administrace. */
  status: z.enum(["draft", "published"]),
  publishedAt: z.iso.date(),
  updatedAt: z.iso.date(),
  translations: z.object(
    Object.fromEntries(locales.map((locale) => [locale, articleTranslationSchema])) as Record<
      Locale,
      typeof articleTranslationSchema
    >,
  ),
});

export type ArticleTranslation = z.infer<typeof articleTranslationSchema>;
export type Article = z.infer<typeof articleSchema>;

/** Odhad doby čtení v minutách (200 slov za minutu, aspoň 1). */
export function readingMinutes(body: string): number {
  return Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 200));
}

/** Adresa článku v jazyce `locale` (`/blog/svatebni-web`, `/en/blog/wedding-website`). */
export function articlePath(article: Article, locale: Locale): string {
  return `${localizedPath("blog", locale)}/${article.translations[locale].slug}`;
}

/** Adresy článku ve všech jazycích (přepínač jazyka, `hreflang`). */
export function articlePaths(article: Article): Record<Locale, string> {
  return Object.fromEntries(locales.map((l) => [l, articlePath(article, l)])) as Record<
    Locale,
    string
  >;
}
