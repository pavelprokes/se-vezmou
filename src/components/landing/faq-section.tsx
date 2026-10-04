import { Accordion } from "@/components/ui/accordion";
import { operator } from "@/config/operator";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { getFaqItems } from "./faq";
import { Section, sectionTitleClass } from "./section";

/** FAQ: šest otázek v rozbalovacím seznamu; celý text je v HTML i bez JavaScriptu. */
export async function FaqSection({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  const items = await getFaqItems(locale);

  return (
    <Section id="faq" headingId="faq-title">
      <div className="grid gap-10 md:grid-cols-[1fr_1.7fr] md:gap-16">
        <div>
          <h2 id="faq-title" className={sectionTitleClass}>
            {t("landing.faq.title")}
          </h2>
          <p className="text-muted mt-4 text-lg text-pretty">
            {t("landing.faq.lead", { contact: operator.contact })}
          </p>
        </div>
        <Accordion
          items={items.map((item) => ({
            id: item.id,
            title: item.question,
            content: item.answer,
          }))}
        />
      </div>
    </Section>
  );
}
