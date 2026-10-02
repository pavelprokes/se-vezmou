import type { Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";
import { LocalizedNameForm } from "./name-form-section";
import { Section } from "./section";

/** Závěrečná výzva: pole jmen, která předvyplní průvodce. */
export function CtaSection({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <Section id="start" headingId="cta-title" tone="cinnamon">
      <div className="mx-auto max-w-3xl text-center">
        <h2
          id="cta-title"
          className="font-sans text-3xl leading-tight font-bold tracking-tight text-balance md:text-4xl"
        >
          {t("landing.cta.title")}
        </h2>
        <p className="mt-3 text-lg">{t("landing.cta.lead")}</p>
        <div className="mt-8 text-left">
          <LocalizedNameForm locale={locale} variant="cta" />
        </div>
      </div>
    </Section>
  );
}
