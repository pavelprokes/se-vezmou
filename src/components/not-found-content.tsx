import { localizedPath } from "@/i18n/pathnames";
import { buttonVariants } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";

/** Stránka 404: stejný text pro neexistující cestu i neexistující web páru (FR-PRIV-3). */
export function NotFoundContent({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-8">
      <h1 className="text-ink text-4xl font-medium">{t("common.notFound.title")}</h1>
      <p className="text-muted mt-4 max-w-prose text-lg">{t("common.notFound.body")}</p>
      <a href={localizedPath("home", locale)} className={`${buttonVariants()} mt-8`}>
        {t("common.brand")}
      </a>
    </main>
  );
}
