import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { appUrl } from "@/lib/site";
import { NameForm } from "./name-form";

/** Pole jmen závěrečné výzvy se serverem přeloženými popisky (klient nenačítá katalogy překladů). */
export async function LocalizedNameForm({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  return (
    <NameForm
      appUrl={appUrl}
      locale={locale}
      variant="cta"
      labels={{
        first: t("landing.form.first"),
        second: t("landing.form.second"),
        firstPlaceholder: t("landing.form.firstPlaceholder"),
        secondPlaceholder: t("landing.form.secondPlaceholder"),
        submit: t("landing.form.ctaSubmit"),
        form: t("landing.cta.title"),
      }}
    />
  );
}
