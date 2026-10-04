import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, SectionHeading, itemTitleClass } from "./section";

/** Po svatbě: režim poděkování (fáze `thanks`: skryje potvrzení účasti a dary, ukáže poděkování a fotky). */
export async function AfterSection({ locale, number }: { locale: Locale; number?: number }) {
  const t = await getTranslator(locale, ["landing"]);
  return (
    <Section id="after" headingId="after-title">
      <SectionHeading
        id="after-title"
        number={number}
        title={t.rich("landing.after.title", {
          b: (children) => <span className="heading-accent">{children}</span>,
        })}
        lead={t("landing.after.lead")}
      />
      <ul className="mt-12 grid gap-10 md:grid-cols-3">
        {([1, 2, 3] as const).map((n) => (
          <li key={n} className="border-ink border-t-2 pt-5">
            <h3 className={itemTitleClass}>{t(`landing.after.${n}.title`)}</h3>
            <p className="text-muted mt-3 text-lg">{t(`landing.after.${n}.text`)}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
