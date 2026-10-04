import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, SectionHeading } from "./section";

/** Po svatbě: režim poděkování (fáze `thanks`: skryje potvrzení účasti a dary, ukáže poděkování a fotky). */
export async function AfterSection({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  return (
    <Section id="after" headingId="after-title" tone="cinnamon">
      <SectionHeading
        id="after-title"
        title={t.rich("landing.after.title", {
          b: (children) => <span className="text-linen">{children}</span>,
        })}
        lead={t("landing.after.lead")}
        tone="dark"
      />
      <ul className="mt-10 grid gap-5 md:grid-cols-3">
        {([1, 2, 3] as const).map((n) => (
          <li key={n} className="rounded-2xl bg-black/10 p-6">
            <h3 className="font-sans text-lg font-bold">{t(`landing.after.${n}.title`)}</h3>
            <p className="mt-2 text-sm">{t(`landing.after.${n}.text`)}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
