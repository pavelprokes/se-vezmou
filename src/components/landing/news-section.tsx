import { operator } from "@/config/operator";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, SectionHeading } from "./section";
import { WaitlistForm } from "./waitlist-form";

/**
 * Novinky a kontakt: newsletter (tabulka `waitlist` zůstala, mění se jen text a smysl souhlasu)
 * a přímý kontakt. Skutečné reference zatím nejsou, a proto tu nejsou ani zástupné karty
 * (žádné vymyšlené recenze, žádná strukturovaná data `Review`); sekce se přidá, až budou (docs/todo.md).
 */
export async function NewsSection({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  return (
    <Section id="news" headingId="news-title" tone="warm">
      <SectionHeading id="news-title" title={t("landing.news.title")} />
      <div className="mt-10 grid items-start gap-6 md:grid-cols-2">
        <WaitlistForm locale={locale} />
        <section
          aria-labelledby="news-contact-title"
          className="border-hairline rounded-2xl border bg-white p-6 md:p-8"
        >
          <h3 id="news-contact-title" className="font-sans text-xl font-bold">
            {t("landing.news.contact.title")}
          </h3>
          <p className="text-muted mt-2">{t("landing.news.contact.text")}</p>
          <a
            href={`mailto:${operator.contact}`}
            className="min-h-target text-ink mt-4 inline-flex items-center font-bold underline underline-offset-4"
          >
            {operator.contact}
          </a>
        </section>
      </div>
    </Section>
  );
}
