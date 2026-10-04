import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, SectionHeading } from "./section";

/** Jak se web sestavuje: čtyři kroky (číslovaný seznam) s velkými číslicemi. */
export async function StepsSection({ locale, number }: { locale: Locale; number?: number }) {
  const t = await getTranslator(locale, ["landing"]);
  const steps = ([1, 2, 3, 4] as const).map((n) => ({
    title: t(`landing.steps.${n}.title`),
    text: t(`landing.steps.${n}.text`),
  }));

  return (
    <Section id="how" headingId="steps-title" tone="warm">
      <SectionHeading
        id="steps-title"
        number={number}
        title={t("landing.steps.title")}
        lead={t("landing.steps.lead")}
      />
      <ol
        aria-label={t("landing.steps.list")}
        className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4"
      >
        {steps.map((step, index) => (
          <li key={step.title} className="min-w-0">
            {/* Pořadí nese samotný číslovaný seznam; číslice je jen ozdoba. */}
            <span
              aria-hidden="true"
              className="font-display text-cinnamon-deep block text-7xl leading-none font-light"
            >
              {index + 1}
            </span>
            <h3 className="mt-4 font-sans text-xl leading-snug font-semibold">{step.title}</h3>
            <p className="text-muted mt-2 text-lg">{step.text}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
