import "server-only";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Locale } from "@/i18n/config";
import { articleSchema, articleState, pragueToday, type Article } from "./article";

/**
 * Články blogu jako soubory `content/blog/<id>.json` v repozitáři. Stránky blogu, mapa webu
 * a `llms.txt` se vykreslí při sestavení a na Vercelu se obnovují jednou za hodinu (`revalidate`),
 * takže naplánovaný článek se objeví sám v den vydání bez nového nasazení. Soubory k těmto stránkám
 * (i k administraci) přibalí `outputFileTracingIncludes`. Zápis funguje jen mimo Vercel, kde je
 * souborový systém zapisovatelný: článek se upraví lokálně v administraci a do produkce jde commitem.
 */

// ponytail: soubory v repozitáři; až budou články psát lidé bez gitu, přesunout do databáze.
const DIR = path.join(process.cwd(), "content", "blog");

/** Zápis je možný jen mimo Vercel (lokální vývoj). */
export const canWriteArticles = !process.env.VERCEL;

/** Všechny články včetně konceptů, nejnovější první. Neplatný soubor shodí build i test. */
export function allArticles(): Article[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const parsed = articleSchema.safeParse(
        JSON.parse(readFileSync(path.join(DIR, name), "utf8")),
      );
      if (!parsed.success) throw new Error(`content/blog/${name}: ${parsed.error.message}`);
      if (`${parsed.data.id}.json` !== name)
        throw new Error(`content/blog/${name}: id neodpovídá názvu souboru`);
      return parsed.data;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
}

/** Články, které už jsou na webu: zveřejněné s datem vydání dnes nebo dříve (pražský čas). */
export function publishedArticles(today: string = pragueToday()): Article[] {
  return allArticles().filter((article) => articleState(article, today) === "published");
}

export function findArticle(id: string): Article | undefined {
  return allArticles().find((article) => article.id === id);
}

/** Zveřejněný článek podle adresy v daném jazyce (`/en/blog/<slug>` hledá jen anglické adresy). */
export function findPublishedBySlug(locale: Locale, slug: string): Article | undefined {
  return publishedArticles().find((article) => article.translations[locale].slug === slug);
}

export function writeArticle(article: Article): void {
  if (!canWriteArticles) throw new Error("Články lze upravovat jen lokálně.");
  writeFileSync(path.join(DIR, `${article.id}.json`), `${JSON.stringify(article, null, 2)}\n`);
}
