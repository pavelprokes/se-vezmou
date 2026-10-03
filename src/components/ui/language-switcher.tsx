import { localeNames, localeShortNames, locales, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

export interface LanguageSwitcherProps {
  current: Locale;
  /** Adresa téže stránky v každém jazyce (`localizedPaths`, `localeHrefs`). */
  hrefs: Record<Locale, string>;
  /** Přeložený název navigace (`t("common.language.label")`). */
  label: string;
  /**
   * Zkratky pro těsná místa (`CS`, `EN`, `localeShortNames`). Přístupný název pak je
   * „CS, Čeština“, aby viditelný text byl součástí názvu (WCAG 2.5.3).
   */
  short?: boolean;
  className?: string;
}

/**
 * Přepínač jazyka jako obyčejné odkazy, funguje bez JavaScriptu. Názvy jazyků jsou každý ve svém
 * jazyce (`localeNames`). Klik na odkaz je výslovná volba: proxy ji pozná podle navigace z vlastního
 * webu, nepřesměruje a zapamatuje v cookie `NEXT_LOCALE` (ADR 0013).
 * Odkaz nese `lang` a `hreflang` (WCAG 3.1.2), aktuální jazyk `aria-current` a není označen jen barvou.
 */
export function LanguageSwitcher({
  current,
  hrefs,
  label,
  short = false,
  className,
}: LanguageSwitcherProps) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex items-center gap-1">
        {locales.map((locale) => {
          const active = locale === current;
          return (
            <li key={locale}>
              <a
                href={hrefs[locale]}
                lang={locale}
                hrefLang={locale}
                aria-label={
                  short ? `${localeShortNames[locale]}, ${localeNames[locale]}` : undefined
                }
                aria-current={active ? "true" : undefined}
                className={cn(
                  "min-h-target min-w-target rounded-button inline-flex items-center justify-center px-3 text-base",
                  active
                    ? "bg-linen text-ink font-semibold underline underline-offset-4"
                    : "text-pine hover:bg-linen",
                )}
              >
                {short ? localeShortNames[locale] : localeNames[locale]}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
