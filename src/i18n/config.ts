export const locales = ["cs", "en"] as const;
export type Locale = (typeof locales)[number];

/** Čeština je výchozí a žije na `/`, angličtina pod `/en` (ADR 0003). */
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

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
