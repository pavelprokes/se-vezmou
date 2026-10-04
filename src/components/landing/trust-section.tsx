import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { Section, SectionHeading, itemTitleClass } from "./section";

/** Soukromí a přístupnost: tmavá sekce se třemi sliby. */
export async function TrustSection({ locale, number }: { locale: Locale; number?: number }) {
  const t = await getTranslator(locale, ["landing"]);
  const items = [
    { title: t("landing.trust.hidden.title"), text: t("landing.trust.hidden.text") },
    { title: t("landing.trust.pin.title"), text: t("landing.trust.pin.text") },
    { title: t("landing.trust.accessible.title"), text: t("landing.trust.accessible.text") },
  ];

  return (
    <Section id="privacy" headingId="trust-title" tone="ink">
      <SectionHeading
        id="trust-title"
        number={number}
        title={t("landing.trust.title")}
        lead={t("landing.trust.lead")}
        tone="dark"
      />
      <ul className="mt-12 grid gap-10 md:grid-cols-3">
        {items.map((item) => (
          <li key={item.title} className="border-pine border-t-2 pt-5">
            <h3 className={itemTitleClass}>{item.title}</h3>
            <p className="text-linen mt-3 text-lg">{item.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
