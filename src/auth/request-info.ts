import { defaultLocale, type Locale } from "@/i18n/config";

/** Čisté funkce nad hlavičkami požadavku (testovatelné bez Next.js). */

type HeaderGetter = (name: string) => string | null | undefined;

/**
 * IP klienta pro omezení počtu požadavků (docs/adr/0010: z důvěryhodné hlavičky, ne z té, kterou
 * může klient podvrhnout). Na Vercelu (`VERCEL=1`) ji platforma nastavuje sama; jinde (vývoj, testy)
 * se čte `x-forwarded-for`, aby šly testy rozlišit klienty. Prázdná hodnota = `unknown`.
 */
export function clientIp(get: HeaderGetter, onVercel: boolean): string {
  const raw = onVercel
    ? (get("x-vercel-forwarded-for") ?? get("x-real-ip") ?? get("x-forwarded-for"))
    : (get("x-forwarded-for") ?? get("x-real-ip"));
  const first = raw?.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : "unknown";
}

/**
 * Kontrola původu u mutací: hlavička `Origin` musí být a její host musí odpovídat hostiteli
 * požadavku (`X-Forwarded-Host`, jinak `Host`). Next.js u Server Actions porovnává totéž, ale
 * požadavek bez `Origin` jen projde s varováním; tady se takový požadavek odmítá
 * (docs/security-privacy.md kap. 2).
 */
export function isSameOrigin(
  origin: string | null | undefined,
  host: string | null | undefined,
  forwardedHost: string | null | undefined,
): boolean {
  if (!origin || origin === "null") return false;
  const expected = (forwardedHost?.split(",")[0] ?? host)?.trim().toLowerCase();
  if (!expected) return false;
  try {
    return new URL(origin).host.toLowerCase() === expected;
  } catch {
    return false;
  }
}

/** Jazyk rozhraní správy z `Accept-Language`: angličtina jen když ji prohlížeč upřednostňuje před češtinou. */
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return defaultLocale;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { lang: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { lang } of ranked) {
    if (lang === "cs") return "cs";
    if (lang === "en") return "en";
  }
  return defaultLocale;
}
