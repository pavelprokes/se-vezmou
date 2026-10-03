import { defaultLocale, type Locale, localePath } from "@/i18n/config";

/**
 * Adresy webu páru a odkazu na náhled konceptu. Čistý modul: doména závisí na prostředí
 * (ostrý provoz `se-vezmou.cz`, lokálně `*.localhost` s portem), proto se odvozuje z hostitele
 * `app.`, na kterém pár právě je, nikdy z hodnoty, kterou poslal klient.
 */

const HOST = /^app\.([a-z0-9.-]+)(:\d{1,5})?$/i;

function isLocal(domain: string): boolean {
  return domain === "localhost" || domain.endsWith(".localhost");
}

/** `app.se-vezmou.cz` + `klara-a-matej` -> `https://klara-a-matej.se-vezmou.cz`. */
export function tenantOrigin(
  slug: string,
  appHost: string | null | undefined,
  fallbackDomain = "se-vezmou.cz",
): string {
  const match = appHost ? HOST.exec(appHost.trim().toLowerCase()) : null;
  const domain = match ? match[1] : fallbackDomain;
  const port = match?.[2] ?? "";
  return `${isLocal(domain) ? "http" : "https"}://${slug}.${domain}${port}`;
}

/** Cesta úvodní stránky webu v jazyce (výchozí jazyk bez předpony, ostatní pod `/<jazyk>`). */
export function sitePath(locale: Locale): string {
  return localePath("/", locale);
}

export function siteUrl(
  slug: string,
  appHost: string | null | undefined,
  locale: Locale = defaultLocale,
  fallbackDomain?: string,
): string {
  return `${tenantOrigin(slug, appHost, fallbackDomain)}${sitePath(locale)}`;
}

/** Odkaz na náhled konceptu: `/nahled/<token>` (výchozí jazyk) nebo `/<jazyk>/nahled/<token>`. */
export function previewUrl(
  slug: string,
  token: string,
  appHost: string | null | undefined,
  locale: Locale = defaultLocale,
  fallbackDomain?: string,
): string {
  const path = localePath(`/nahled/${token}`, locale);
  return `${tenantOrigin(slug, appHost, fallbackDomain)}${path}`;
}

/** Adresa pro popisky a tisk bez schématu: `klara-a-matej.se-vezmou.cz`. */
export function displayHost(
  slug: string,
  appHost: string | null | undefined,
  fallbackDomain?: string,
): string {
  return tenantOrigin(slug, appHost, fallbackDomain).replace(/^https?:\/\//, "");
}
