import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, SectionHeading, itemTitleClass } from "./section";

/** Problém a řešení: tři otázky, které hosté kladou pořád dokola (sloupce s linkou nahoře). */
export async function ProblemSection({ locale, number }: { locale: Locale; number?: number }) {
  const t = await getTranslator(locale, ["landing"]);
  const items = [
    { title: t("landing.problem.q1.title"), text: t("landing.problem.q1.text") },
    { title: t("landing.problem.q2.title"), text: t("landing.problem.q2.text") },
    { title: t("landing.problem.q3.title"), text: t("landing.problem.q3.text") },
  ];

  return (
    <Section headingId="problem-title">
      <SectionHeading
        id="problem-title"
        number={number}
        title={t.rich("landing.problem.title", {
          b: (children) => <span className="heading-accent">{children}</span>,
        })}
        lead={t("landing.problem.lead")}
      />
      <ul className="mt-12 grid gap-10 md:grid-cols-3">
        {items.map((item) => (
          <li key={item.title} className="border-ink border-t-2 pt-5">
            <h3 className={itemTitleClass}>{item.title}</h3>
            <p className="text-muted mt-3 text-lg">{item.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
