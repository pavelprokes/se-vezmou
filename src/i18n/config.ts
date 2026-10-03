/**
 * Jediné místo, které vyjmenovává jazyky (ADR 0003, ADR 0013). Typ `Locale` se odvozuje odsud a
 * tabulky po jazycích jsou `Record<Locale, ...>`, takže po přidání jazyka TypeScript označí každé
 * místo, které je potřeba doplnit (postup: ADR 0013, „Jak přidat jazyk“).
 */
export const locales = ["cs", "en"] as const;
export type Locale = (typeof locales)[number];

/**
 * Výchozí jazyk: čeština. Žije bez předpony (`/`), ostatní jazyky pod `/<jazyk>`; vše, co jazyk
 * neurčuje, je česky a každá náhrada vede z požadovaného jazyka na tento (nikdy na „ten druhý“).
 */
export const defaultLocale: Locale = "cs";

/** Hodnota atributu `lang` (WCAG 3.1.1). Britská angličtina čeká na potvrzení majitele. */
export const htmlLang: Record<Locale, string> = {
  cs: "cs",
  en: "en-GB",
};

/** Lokalita pro `Intl`. */
export const intlLocale: Record<Locale, string> = {
  cs: "cs-CZ",
  en: "en-GB",
};

/** Název jazyka v tom jazyce (přepínače jazyka): stejný na každé stránce, proto ne v překladech. */
export const localeNames: Record<Locale, string> = {
  cs: "Čeština",
  en: "English",
};

/** Zkratky jazyků pro těsná místa (přepínač v hlavičce úvodní stránky). */
export const localeShortNames: Record<Locale, string> = {
  cs: "CS",
  en: "EN",
};

export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Jazyk z hodnoty, kterou nikdo neověřil (parametr, hlavička, databáze); jinak výchozí jazyk. */
export function toLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : defaultLocale;
}

/**
 * Cesta s předponou jazyka: výchozí jazyk bez předpony, ostatní pod `/<jazyk>`
 * (`/web` -> `/en/web`, `/` -> `/en`). Cesta musí začínat lomítkem a nesmí předponu už mít.
 */
export function localePath(path: string, locale: Locale): string {
  if (locale === defaultLocale) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/**
 * Opak `localePath`: `/en/web` -> `{ locale: "en", path: "/web" }`, cesta bez předpony je ve výchozím
 * jazyce. Předpona výchozího jazyka (`/cs/...`) je duplicita a vrací `null` (404). Neznámá předpona
 * (`/de/...`) není jazyk, ale obyčejná cesta výchozího jazyka.
 */
export function splitLocalePath(pathname: string): { locale: Locale; path: string } | null {
  const end = pathname.indexOf("/", 1);
  const first = end === -1 ? pathname.slice(1) : pathname.slice(1, end);
  if (!isLocale(first)) return { locale: defaultLocale, path: pathname };
  if (first === defaultLocale) return null;
  return { locale: first, path: end === -1 ? "/" : pathname.slice(end) };
}
