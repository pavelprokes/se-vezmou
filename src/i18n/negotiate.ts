import { defaultLocale, isLocale, locales, type Locale } from "./config";

/**
 * Určení jazyka požadavku (ADR 0013). Čistý modul bez Next.js; používá ho jen `src/proxy.ts`
 * (hostitelé úvodní stránky, `app.` a `admin.`). Server Components jazyk nevyjednávají, čtou jen
 * výsledek z hlavičky, kterou nastaví proxy.
 *
 * Pořadí: předpona jazyka v adrese > cookie `NEXT_LOCALE` > `Accept-Language` > výchozí jazyk.
 */

/** Standardní název cookie s volbou jazyka (Next.js, next-intl). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Platnost cookie s volbou jazyka: jeden rok. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface LanguageRange {
  /** Jazyková značka malými písmeny (`en-gb`) nebo `*`. */
  tag: string;
  q: number;
}

/**
 * Rozbor `Accept-Language` (RFC 9110, kap. 12.5.4): položky seřazené podle `q` sestupně,
 * se stejnou vahou v pořadí z hlavičky. Neplatná váha nebo značka se ignoruje; `q=0` zůstává
 * (znamená „nepřijatelné“).
 */
export function parseAcceptLanguage(header: string | null | undefined): LanguageRange[] {
  if (!header) return [];
  const ranges: (LanguageRange & { index: number })[] = [];
  header.split(",").forEach((part, index) => {
    const [rawTag, ...params] = part.trim().split(";");
    const tag = rawTag.trim().toLowerCase();
    if (!/^(\*|[a-z]{1,8}(-[a-z0-9]{1,8})*)$/.test(tag)) return;
    let q = 1;
    for (const param of params) {
      const [name, value] = param.trim().split("=");
      if (name?.trim().toLowerCase() !== "q") continue;
      const trimmed = value?.trim() ?? "";
      // RFC 9110: qvalue = ( "0" [ "." 0*3DIGIT ] ) / ( "1" [ "." 0*3("0") ] )
      if (!/^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(trimmed)) return;
      q = Number(trimmed);
    }
    ranges.push({ tag, q, index });
  });
  return ranges.sort((a, b) => b.q - a.q || a.index - b.index).map(({ tag, q }) => ({ tag, q }));
}

function primary(tag: string): string {
  return tag.split("-")[0];
}

/**
 * Nejlepší z nabízených jazyků pro `Accept-Language`, jinak `null`. Shoda přesná nebo podle hlavní
 * podznačky (`en-GB` -> `en`, `cs-CZ` -> `cs`). `*` znamená libovolný jazyk, tedy výchozí (pokud
 * ho prohlížeč nevyloučil `q=0`), jinak první nevyloučený. Hodnotí se jen nabízené jazyky.
 */
export function matchAcceptLanguage(
  header: string | null | undefined,
  available: readonly Locale[] = locales,
): Locale | null {
  const ranges = parseAcceptLanguage(header);
  const excluded = new Set<Locale>();
  for (const { tag, q } of ranges) {
    if (q > 0 || tag === "*") continue;
    for (const locale of available) {
      // `en;q=0` vylučuje i `en-GB`; `en-GB;q=0` nevylučuje celou angličtinu.
      if (locale.toLowerCase() === tag || primary(locale.toLowerCase()) === tag) {
        excluded.add(locale);
      }
    }
  }
  const allowed = available.filter((locale) => !excluded.has(locale));
  for (const { tag, q } of ranges) {
    if (q === 0) continue;
    if (tag === "*") {
      return allowed.includes(defaultLocale) ? defaultLocale : (allowed[0] ?? null);
    }
    const exact = allowed.find((locale) => locale.toLowerCase() === tag);
    if (exact) return exact;
    const byPrimary = allowed.find((locale) => primary(locale.toLowerCase()) === primary(tag));
    if (byPrimary) return byPrimary;
  }
  return null;
}

export interface NegotiationInput {
  /** Jazyk z předpony adresy (`/en/...`), u cesty bez předpony `null`. */
  pathLocale: Locale | null;
  /** Hodnota cookie `NEXT_LOCALE` (neověřená). */
  cookie: string | null | undefined;
  acceptLanguage: string | null | undefined;
}

/** Jazyk podle pořadí předpona > cookie > `Accept-Language` > výchozí jazyk. */
export function negotiateLocale({ pathLocale, cookie, acceptLanguage }: NegotiationInput): Locale {
  if (pathLocale) return pathLocale;
  return preferredLocale(cookie, acceptLanguage);
}

/** Uložená nebo vyjednaná preference bez ohledu na adresu (cookie > `Accept-Language` > výchozí). */
export function preferredLocale(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (isLocale(cookie)) return cookie;
  return matchAcceptLanguage(acceptLanguage) ?? defaultLocale;
}

type HeaderGetter = (name: string) => string | null | undefined;

/**
 * Načtení dokumentu (GET/HEAD stránky v okně prohlížeče), ne RSC, předběžné načtení, obrázek ani
 * `fetch`. Moderní prohlížeče posílají `Sec-Fetch-Dest`; bez něj (starší klienti, roboti) rozhoduje
 * `Accept: text/html`. Hlavičky RSC (`rsc`, `next-router-prefetch`) proxy nevidí (Next.js je před
 * proxy odebírá), požadavky RSC ale mají `Sec-Fetch-Dest: empty`.
 */
export function isDocumentRequest(method: string, get: HeaderGetter): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const purpose = `${get("sec-purpose") ?? ""} ${get("purpose") ?? ""} ${get("x-moz") ?? ""}`;
  if (/prefetch|prerender/i.test(purpose)) return false;
  if (get("next-router-prefetch") || get("rsc")) return false;
  const dest = get("sec-fetch-dest");
  if (dest) return dest === "document";
  return (get("accept") ?? "").includes("text/html");
}

/**
 * Navigace uživatele z vlastního webu: klik na odkaz nebo odeslání formuláře z jiné stránky téhož
 * hostitele (`Sec-Fetch-Site: same-origin`) nebo jiného hostitele služby (`same-site`, například
 * z úvodní stránky do průvodce). Odkazy služby jazyk vždy nesou v adrese, takže taková navigace je
 * výslovná volba jazyka z adresy. Bez `Sec-Fetch-Site` (starší prohlížeče) rozhoduje `Referer`
 * ze stejného hostitele.
 */
export function isSiteNavigation(get: HeaderGetter, host: string | null | undefined): boolean {
  const site = get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "same-site";
  const referer = get("referer");
  if (!referer || !host) return false;
  try {
    return new URL(referer).host.toLowerCase() === host.trim().toLowerCase();
  } catch {
    return false;
  }
}

export interface LocaleRequest {
  method: string;
  /** Jazyk z předpony adresy, u cesty bez předpony `null`. */
  pathLocale: Locale | null;
  header: HeaderGetter;
  cookie: string | null | undefined;
  /** Hostitel požadavku (pro `Referer` bez `Sec-Fetch-Site`). */
  host: string | null | undefined;
}

export type LocaleDecision =
  /** Vstup na adresu bez předpony s vyjednaným jiným než výchozím jazykem: 307 na adresu s předponou. */
  | { action: "redirect"; locale: Locale }
  /**
   * Stránka se vykreslí v jazyce z adresy. `remember` je jazyk, který se uloží do cookie: jen při
   * výslovném přepnutí, tedy navigaci z vlastního webu na jiný jazyk, než je dosavadní preference.
   */
  | { action: "continue"; locale: Locale; remember: Locale | null };

/**
 * Rozhodnutí proxy o jazyce (ADR 0013):
 *
 * - Jen načtení dokumentu; RSC, předběžné načtení, soubory a API jdou beze změny podle adresy.
 * - Navigace z vlastního webu (přepínač, odkaz) je výslovná volba: platí jazyk z adresy (cesta bez
 *   předpony = výchozí jazyk), nikdy se nepřesměruje, a liší-li se od preference, uloží se do cookie.
 *   Proto přepnutí na češtinu z `/en` s anglickým prohlížečem nevrátí detekce zpět na `/en`.
 * - Adresa s předponou jazyka platí vždy.
 * - Vstup (adresa zadaná ručně, záložka, odkaz zvenku) na cestu bez předpony: preference
 *   (cookie > `Accept-Language`) jiná než výchozí jazyk znamená přesměrování na předponu.
 *   Robot bez `Accept-Language` a bez cookie tak vždy dostane výchozí jazyk bez přesměrování.
 */
export function decideLocale(request: LocaleRequest): LocaleDecision {
  const urlLocale = request.pathLocale ?? defaultLocale;
  if (!isDocumentRequest(request.method, request.header)) {
    return { action: "continue", locale: urlLocale, remember: null };
  }
  const preferred = preferredLocale(request.cookie, request.header("accept-language"));
  if (isSiteNavigation(request.header, request.host)) {
    return {
      action: "continue",
      locale: urlLocale,
      remember: urlLocale === preferred ? null : urlLocale,
    };
  }
  if (request.pathLocale === null && preferred !== defaultLocale) {
    return { action: "redirect", locale: preferred };
  }
  return { action: "continue", locale: urlLocale, remember: null };
}
