import { locales, type Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/pathnames";

/**
 * Původ webu páru z hlaviček požadavku (`https://klara-a-matej.se-vezmou.cz`). Doména závisí na
 * prostředí (lokálně `*.localhost`), proto se nebere z konfigurace, ale z hostitele požadavku.
 */
export function originFromHeaders(host: string | null, forwardedProto: string | null): string {
  const safeHost = host && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? host : "localhost";
  const hostname = safeHost.split(":")[0];
  const proto =
    forwardedProto?.split(",")[0]?.trim() === "http" || hostname.endsWith("localhost")
      ? "http"
      : "https";
  return `${proto}://${safeHost}`;
}

/**
 * Adresy jazykových verzí webu pro `hreflang`: jen jazyky webu a `x-default` na výchozí jazyk.
 * Web se neindexuje (hlavička `X-Robots-Tag` z proxy), `hreflang` se přesto zveřejňuje.
 */
export function languageAlternates(
  origin: string,
  siteLocales: readonly Locale[],
  defaultLocale: Locale,
): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const locale of locales) {
    if (siteLocales.includes(locale)) {
      urls[locale] = new URL(localizedPath("home", locale), origin).toString();
    }
  }
  urls["x-default"] = urls[defaultLocale];
  return urls;
}
