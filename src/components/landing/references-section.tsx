import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, SectionHeading } from "./section";
import { WaitlistForm } from "./waitlist-form";

/**
 * Reference: zatím jen zástupný text, žádné vymyšlené recenze a žádná strukturovaná data `Review`.
 * Pod nimi je čekací listina (zástupný program přátelských párů).
 */
export async function ReferencesSection({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  const quotes = [
    t("landing.references.q1"),
    t("landing.references.q2"),
    t("landing.references.q3"),
  ];

  return (
    <Section id="references" headingId="references-title" tone="warm">
      <SectionHeading
        id="references-title"
        title={t("landing.references.title")}
        lead={t("landing.references.lead")}
      />
      <ul className="mt-10 grid gap-5 md:grid-cols-3">
        {quotes.map((quote) => (
          <li
            key={quote}
            className="border-field-border bg-parchment flex flex-col rounded-2xl border border-dashed p-6"
          >
            <p className="text-cinnamon-deep text-xs font-bold tracking-widest uppercase">
              {t("landing.references.placeholder")}
            </p>
            <p className="text-ink mt-3 flex-1 text-base">{quote}</p>
            <p className="text-muted mt-4 text-xs">{t("landing.references.author")}</p>
          </li>
        ))}
      </ul>
      <p className="text-muted mt-6 max-w-3xl text-sm">{t("landing.references.note")}</p>
      <WaitlistForm locale={locale} />
    </Section>
  );
}
