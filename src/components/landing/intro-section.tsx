import type { Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";
import { LocalizedNameForm } from "./name-form-section";
import { Section } from "./section";

/** Co je služba: odpovědní blok (definice) a pole jmen s živým náhledem adresy. */
export function IntroSection({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <Section headingId="intro-title" tone="warm">
      <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
        <div>
          <h2
            id="intro-title"
            className="font-sans text-3xl leading-tight font-bold tracking-tight md:text-4xl"
          >
            {t("landing.intro.title")}
          </h2>
          <p className="text-ink mt-5 text-lg font-medium text-pretty">{t("landing.intro.lead")}</p>
          <p className="text-muted mt-4 text-pretty">{t("landing.intro.more")}</p>
        </div>
        <LocalizedNameForm locale={locale} variant="intro" />
      </div>
    </Section>
  );
}
