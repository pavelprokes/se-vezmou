import { BrandLogo } from "@/components/brand-logo";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import type { Locale } from "@/i18n/config";
import { localizedPath, localizedPaths, type RouteName } from "@/i18n/pathnames";
import { getTranslator } from "@/i18n/load";

export interface SiteHeaderProps {
  locale: Locale;
  /** Stránka, na které hlavička stojí; přepínač odkazuje na její druhou jazykovou verzi. */
  route: RouteName;
}

export async function SiteHeader({ locale, route }: SiteHeaderProps) {
  const t = await getTranslator(locale, ["common"]);

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
      <a
        href={localizedPath("home", locale)}
        className="min-h-target text-ink inline-flex items-center text-xl"
      >
        <BrandLogo />
      </a>
      <LanguageSwitcher
        current={locale}
        hrefs={localizedPaths(route)}
        label={t("common.language.label")}
      />
    </header>
  );
}
