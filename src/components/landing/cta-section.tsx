import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { LocalizedNameForm } from "./name-form-section";
import { Section, sectionTitleClass } from "./section";

/** Závěrečná výzva: pole jmen, která předvyplní průvodce. */
export async function CtaSection({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  return (
    <Section id="start" headingId="cta-title" tone="cinnamon">
      <div className="mx-auto max-w-3xl text-center">
        <h2 id="cta-title" className={sectionTitleClass}>
          {t("landing.cta.title")}
        </h2>
        <p className="mt-3 text-lg">{t("landing.cta.lead")}</p>
        <div className="mt-8 text-left">
          <LocalizedNameForm locale={locale} />
        </div>
      </div>
    </Section>
  );
}
