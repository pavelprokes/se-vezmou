import { defaultLocale, localePath, locales, type Locale } from "./config";

/**
 * Jediná tabulka veřejných cest úvodní stránky (ADR 0003, ADR 0013). Čerpá z ní proxy, odkazy,
 * `hreflang` i mapa webu. Výchozí jazyk je bez předpony, ostatní pod `/<jazyk>`; předponu přidává
 * `localePath`, v tabulce se nepíše.
 *
 * Řádek je buď jedna cesta, která se nepřekládá (`home: "/"` -> `/` a `/en`), nebo přeložené
 * cesty pro každý jazyk (`privacy: { cs: "/soukromi", en: "/privacy" }` -> `/soukromi`
 * a `/en/privacy`); `Record<Locale, ...>` vynutí doplnění po přidání jazyka. Nepřeložená varianta
 * (`/privacy` česky, `/en/soukromi`) vrací 404 (žádné duplicity).
 * Přidání stránky = nový řádek, např. `pricing: { cs: "/cenik", en: "/pricing" }`; stránka pak potřebuje složku s `page.tsx` pro každý jazyk.
 */
const routes = {
  home: "/",
  pricing: { cs: "/cenik", en: "/pricing" },
  templates: { cs: "/sablony", en: "/templates" },
  bilingual: { cs: "/dvojjazycny-svatebni-web", en: "/bilingual-wedding-website" },
  privacy: { cs: "/soukromi", en: "/privacy" },
  terms: { cs: "/podminky", en: "/terms" },
  accessibility: { cs: "/dostupnost", en: "/accessibility" },
} as const satisfies Record<string, string | Record<Locale, string>>;

export type RouteName = keyof typeof routes;

function build(): Record<RouteName, Record<Locale, string>> {
  const out = {} as Record<RouteName, Record<Locale, string>>;
  for (const route of Object.keys(routes) as RouteName[]) {
    const definition: string | Record<Locale, string> = routes[route];
    out[route] = Object.fromEntries(
      locales.map((locale) => [
        locale,
        localePath(typeof definition === "string" ? definition : definition[locale], locale),
      ]),
    ) as Record<Locale, string>;
  }
  return out;
}

/** Veřejné cesty každé stránky v každém jazyce (s předponou): `pathnames.privacy.en === "/en/privacy"`. */
export const pathnames: Readonly<Record<RouteName, Readonly<Record<Locale, string>>>> = build();

export function localizedPath(route: RouteName, locale: Locale): string {
  return pathnames[route][locale];
}

/** Cesty téže stránky ve všech jazycích (přepínač jazyka). */
export function localizedPaths(route: RouteName): Record<Locale, string> {
  return { ...pathnames[route] };
}

/** Absolutní adresy všech jazykových verzí stránky a `x-default` (výchozí jazyk). */
export function languageUrls(route: RouteName, siteUrl: string): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const locale of locales) {
    urls[locale] = new URL(localizedPath(route, locale), siteUrl).toString();
  }
  urls["x-default"] = urls[defaultLocale];
  return urls;
}

/**
 * Pomocník pro `generateMetadata`: `canonical` na sebe a `hreflang` všech verzí
 * (každý jazyk a `x-default`). Používá se jen na marketingovém hostiteli.
 */
export function hreflangAlternates(route: RouteName, locale: Locale, siteUrl: string) {
  const languages = languageUrls(route, siteUrl);
  return { canonical: languages[locale], languages };
}

/** Vrátí stránku a jazyk podle veřejné cesty, nebo `null` pro neznámou nebo nepřeloženou cestu. */
export function matchPathname(pathname: string): { route: RouteName; locale: Locale } | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const route of Object.keys(pathnames) as RouteName[]) {
    for (const locale of locales) {
      if (pathnames[route][locale] === normalized) return { route, locale };
    }
  }
  return null;
}
