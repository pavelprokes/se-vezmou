import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, itemTitleClass, sectionTitleClass } from "./section";

/** Základní fakta o službě doslova (`marketing.facts.*`); stejné věty jsou i v `llms.txt`. */
export const FACT_KEYS = [
  "templates",
  "address",
  "rsvp",
  "indexing",
  "languages",
  "price",
] as const;

export async function FactsSection({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["marketing"]);
  return (
    <Section headingId="facts-title" tone="warm" className="print:hidden">
      <h2 id="facts-title" className={sectionTitleClass}>
        {t("marketing.facts.title")}
      </h2>
      <dl className="mt-12 grid gap-x-10 gap-y-8 md:grid-cols-2">
        {FACT_KEYS.map((key) => (
          <div key={key} className="border-ink border-t-2 pt-5">
            <dt className={itemTitleClass}>{t(`marketing.facts.${key}.label`)}</dt>
            <dd className="text-muted mt-3 text-lg">{t(`marketing.facts.${key}.value`)}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
