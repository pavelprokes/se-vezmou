import "server-only";
import { articlePath, pragueToday, type Article } from "@/blog/article";
import { publishedArticles } from "@/blog/store";
import { locales } from "@/i18n/config";
import { localizedPath } from "@/i18n/pathnames";
import { siteUrl } from "@/lib/site";
import type { JobDefinition } from "../run";

/**
 * Zveřejnění naplánovaných článků hned po půlnoci (pražský čas), bez čekání na první návštěvu.
 * Stránky blogu, mapa webu a `llms.txt` mají ISR s `revalidate = 60`: první požadavek po minutě
 * vrátí starou verzi a spustí přegenerování. Úloha proto stránky sama načítá znovu, dokud v nich
 * dnešní články nejsou (článek vrací 200, rozcestník, mapa webu a llms.txt obsahují jeho adresu).
 * `revalidatePath` tu nepomůže: v route handleru se provede až po odeslání odpovědi, tedy po načtení.
 */

/** Pauza mezi pokusy; ISR se obnoví nejpozději po 60 s, rozpočet úlohy je 50 s. */
const RETRY_MS = 5_000;

export type Check = { path: string; ready: (status: number, body: string) => boolean };

/** Co má být po půlnoci na webu vidět: dnešní články a odkazy na ně v rozcestníku, mapě webu a llms.txt. */
export function checksFor(fresh: readonly Article[]): Check[] {
  const listed = (paths: string[]) => (status: number, body: string) =>
    status === 200 && paths.every((path) => body.includes(path));
  return [
    ...locales.flatMap((locale) => {
      const paths = fresh.map((article) => articlePath(article, locale));
      return [
        { path: localizedPath("blog", locale), ready: listed(paths) },
        ...paths.map((path) => ({ path, ready: (status: number) => status === 200 })),
      ];
    }),
    ...["/sitemap.xml", "/llms.txt"].map((path) => ({
      path,
      ready: listed(locales.flatMap((l) => fresh.map((article) => articlePath(article, l)))),
    })),
  ];
}

/** Načítá adresu, dokud neodpovídá `ready`, nebo dokud nedojde čas. */
export async function warmUntilReady(
  check: Check,
  deadline: number,
  retryMs: number = RETRY_MS,
): Promise<boolean> {
  for (;;) {
    try {
      const response = await fetch(new URL(check.path, siteUrl), {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (check.ready(response.status, await response.text())) return true;
    } catch {
      // síť nebo časový limit: další pokus, dokud zbývá čas
    }
    if (Date.now() + retryMs >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
}

export const blogPublishJob: JobDefinition = {
  name: "blog_publish",
  async run(context) {
    const today = pragueToday(context.now);
    const fresh = publishedArticles(today).filter((article) => article.publishedAt === today);
    const counts: Record<string, number> = {
      published_today: fresh.length,
      ready: 0,
      not_ready: 0,
    };
    if (context.dryRun) return { status: "ok", counts };

    const deadline = Date.now() + context.timeLeftMs();
    const results = await Promise.all(
      checksFor(fresh).map((check) => warmUntilReady(check, deadline)),
    );
    for (const ok of results) counts[ok ? "ready" : "not_ready"] += 1;
    return { status: counts.not_ready > 0 ? "partial" : "ok", counts };
  },
};
