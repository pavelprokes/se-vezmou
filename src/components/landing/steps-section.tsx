import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";
import { Section, SectionHeading } from "./section";

/** Dekorativní náhled kroku: čtečky ho přeskočí, text kroku je vždy v popisu nad ním. */
function Mock({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden="true" className="bg-warm mt-5 overflow-hidden rounded-xl p-3">
      {children}
    </div>
  );
}

function MockField({ children }: { children: ReactNode }) {
  return (
    <div className="border-field-border text-ink rounded-md border bg-white px-2 py-1 text-xs">
      {children}
    </div>
  );
}

/** Jak se web sestavuje: čtyři kroky (číslovaný seznam). */
export function StepsSection({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);

  const steps: { title: string; text: string; mock: ReactNode }[] = [
    {
      title: t("landing.steps.1.title"),
      text: t("landing.steps.1.text"),
      mock: (
        <Mock>
          <div className="flex flex-col gap-1.5">
            <MockField>{t("landing.sample.first")}</MockField>
            <MockField>{t("landing.sample.second")}</MockField>
          </div>
        </Mock>
      ),
    },
    {
      title: t("landing.steps.2.title"),
      text: t("landing.steps.2.text"),
      mock: (
        <Mock>
          <div className="flex items-center gap-2">
            <span className="border-field-border bg-parchment size-10 rounded-md border-2" />
            <span className="bg-linen relative size-10 rounded-md">
              <span className="bg-pine absolute top-2 left-3 size-2 rounded-full" />
              <span className="bg-cinnamon absolute top-4 left-6 size-2 rounded-full" />
            </span>
            <span className="bg-ink relative size-10 rounded-md">
              <span className="bg-cinnamon absolute right-1.5 bottom-1.5 left-1.5 h-3 rounded-sm" />
            </span>
          </div>
        </Mock>
      ),
    },
    {
      title: t("landing.steps.3.title"),
      text: t("landing.steps.3.text"),
      mock: (
        <Mock>
          <div className="flex flex-col gap-2 rounded-md bg-white p-2.5">
            {[28, 22, 16].map((width) => (
              <div key={width} className="flex items-center gap-2">
                <span className="bg-pine size-1.5 rounded-full" />
                <span className="bg-linen h-1.5 rounded-full" style={{ width: `${width * 3}px` }} />
              </div>
            ))}
          </div>
        </Mock>
      ),
    },
    {
      title: t("landing.steps.4.title"),
      text: t("landing.steps.4.text"),
      mock: (
        <Mock>
          <div className="flex gap-2 text-xs font-medium">
            <span className="border-pine text-pine min-w-0 flex-1 truncate rounded-md border-2 px-2 py-1 text-center">
              {t("landing.steps.save")}
            </span>
            <span className="border-pine bg-pine text-parchment min-w-0 flex-1 truncate rounded-md border-2 px-2 py-1 text-center">
              {t("landing.steps.publish")}
            </span>
          </div>
        </Mock>
      ),
    },
  ];

  return (
    <Section id="how" headingId="steps-title" tone="warm">
      <SectionHeading
        id="steps-title"
        title={t("landing.steps.title")}
        lead={t("landing.steps.lead")}
      />
      <ol
        aria-label={t("landing.steps.list")}
        className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4"
      >
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="border-hairline bg-parchment min-w-0 rounded-2xl border p-5"
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="bg-cinnamon-deep text-parchment inline-flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
              >
                {index + 1}
              </span>
              <h3 className="pt-0.5 font-sans text-lg leading-snug font-bold">{step.title}</h3>
            </div>
            <p className="text-muted mt-3 text-sm">{step.text}</p>
            {step.mock}
          </li>
        ))}
      </ol>
    </Section>
  );
}
