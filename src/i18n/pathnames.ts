import { defaultLocale, locales, type Locale } from "./config";

/**
 * Jediná tabulka přeložených cest (ADR 0003). Čerpá z ní proxy, odkazy, `hreflang` i mapa webu.
 * Čeština je bez prefixu, angličtina pod `/en`. Nepřeložená varianta vrací 404 (žádné duplicity).
 * Přidání stránky = nový řádek, např. `pricing: { cs: "/cenik", en: "/en/pricing" }`.
 */
export const pathnames = {
  home: { cs: "/", en: "/en" },
} as const satisfies Record<string, Record<Locale, string>>;

export type RouteName = keyof typeof pathnames;

export function localizedPath(route: RouteName, locale: Locale): string {
  return pathnames[route][locale];
}

/** Absolutní adresy všech jazykových verzí stránky a `x-default` (česká verze). */
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
 * (`cs`, `en`, `x-default`). Používá se jen na marketingovém hostiteli.
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
