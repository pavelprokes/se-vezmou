import type { Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";
import { appUrl, siteUrl } from "@/lib/site";
import { NameForm } from "./name-form";

/** Doména pro náhled adresy páru: kořenová doména z `NEXT_PUBLIC_SITE_URL`. */
const domain = new URL(siteUrl).hostname;

/** Pole jmen se serverem přeloženými popisky (klientský formulář nenačítá katalogy překladů). */
export function LocalizedNameForm({
  locale,
  variant,
}: {
  locale: Locale;
  variant: "intro" | "cta";
}) {
  const t = createTranslator(locale);
  return (
    <NameForm
      appUrl={appUrl}
      locale={locale}
      domain={domain}
      variant={variant}
      labels={{
        first: t("landing.form.first"),
        second: t("landing.form.second"),
        firstPlaceholder: t("landing.form.firstPlaceholder"),
        secondPlaceholder: t("landing.form.secondPlaceholder"),
        address: t("landing.form.address"),
        submit: variant === "intro" ? t("landing.form.continue") : t("landing.form.ctaSubmit"),
        form: variant === "intro" ? t("landing.intro.formLabel") : t("landing.cta.title"),
      }}
    />
  );
}
