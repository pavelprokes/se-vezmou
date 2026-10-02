import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { locales, type Locale } from "@/i18n/config";
import { localizedPath, type RouteName } from "@/i18n/pathnames";
import { createTranslator } from "@/i18n/translator";

export interface SiteHeaderProps {
  locale: Locale;
  /** Stránka, na které hlavička stojí; přepínač odkazuje na její druhou jazykovou verzi. */
  route: RouteName;
}

export function SiteHeader({ locale, route }: SiteHeaderProps) {
  const t = createTranslator(locale);
  const hrefs = Object.fromEntries(locales.map((l) => [l, localizedPath(route, l)])) as Record<
    Locale,
    string
  >;

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
      <a
        href={localizedPath("home", locale)}
        className="min-h-target text-ink inline-flex items-center font-serif text-2xl font-medium"
      >
        {t("common.brand")}
      </a>
      <LanguageSwitcher
        current={locale}
        hrefs={hrefs}
        label={t("common.language.label")}
        names={{ cs: t("common.language.cs"), en: t("common.language.en") }}
      />
    </header>
  );
}
