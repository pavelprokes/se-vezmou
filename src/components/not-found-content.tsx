import type { Metadata } from "next";
import { buttonVariants } from "@/components/ui/button";
import { DocumentTitle } from "@/components/document-title";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { localizedPath, localizedPaths } from "@/i18n/pathnames";

/** Titulek stránky 404 (WCAG 2.4.2): ne výchozí titulek značky, který mají ostatní stránky. */
export async function notFoundMetadata(locale: Locale): Promise<Metadata> {
  return { title: (await getTranslator(locale, ["errors"]))("errors.notFound.title") };
}

/**
 * Stránka 404: stejný text pro neexistující cestu i neexistující web páru (FR-PRIV-3). Přepínač
 * jazyka vede na úvod hostitele v každém jazyce (překlad neznámé cesty neexistuje).
 */
export async function NotFoundContent({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["common", "errors"]);
  return (
    <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-8">
      <DocumentTitle title={t("errors.notFound.title")} />
      <h1 className="text-ink text-4xl font-medium">{t("errors.notFound.title")}</h1>
      <p className="text-muted mt-4 max-w-prose text-lg">{t("errors.notFound.body")}</p>
      <a href={localizedPath("home", locale)} className={`${buttonVariants()} mt-8`}>
        {t("common.brand")}
      </a>
      <LanguageSwitcher
        current={locale}
        hrefs={localizedPaths("home")}
        label={t("common.language.label")}
        className="mt-8"
      />
    </main>
  );
}
