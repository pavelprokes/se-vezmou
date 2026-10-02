import { htmlLang, type Locale } from "@/i18n/config";
import type { Translator } from "@/i18n/translator";

export interface SiteLanguageSwitchProps {
  /** Jazyky webu (`weddings.locales`); s jedním jazykem se přepínač nezobrazí. */
  locales: readonly Locale[];
  current: Locale;
  /** Adresa téže stránky v každém jazyce webu. */
  hrefs: Record<Locale, string>;
  t: Translator;
}

/**
 * Přepínač jazyků webu páru jako obyčejné odkazy (bez JavaScriptu, bez automatického přesměrování).
 * Barvy bere z palety šablony; odkaz nese `lang` a `hreflang` (WCAG 3.1.2).
 */
export function SiteLanguageSwitch({ locales, current, hrefs, t }: SiteLanguageSwitchProps) {
  if (locales.length < 2) return null;
  const names: Record<Locale, string> = {
    cs: t("common.language.cs"),
    en: t("common.language.en"),
  };
  return (
    <nav aria-label={t("common.language.label")} className="site-lang">
      <ul>
        {locales.map((locale) => (
          <li key={locale}>
            <a
              href={hrefs[locale]}
              lang={htmlLang[locale]}
              hrefLang={locale}
              aria-current={locale === current ? "true" : undefined}
              className="site-nav-link"
            >
              {names[locale]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
