import type { Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";
import { Section, SectionHeading } from "./section";

/** Soukromí a přístupnost: tmavá sekce se třemi sliby. */
export function TrustSection({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const items = [
    { title: t("landing.trust.hidden.title"), text: t("landing.trust.hidden.text") },
    { title: t("landing.trust.pin.title"), text: t("landing.trust.pin.text") },
    { title: t("landing.trust.accessible.title"), text: t("landing.trust.accessible.text") },
  ];

  return (
    <Section id="privacy" headingId="trust-title" tone="ink">
      <SectionHeading
        id="trust-title"
        title={t("landing.trust.title")}
        lead={t("landing.trust.lead")}
        tone="dark"
      />
      <ul className="mt-10 grid gap-8 md:grid-cols-3">
        {items.map((item) => (
          <li key={item.title} className="border-pine border-t-2 pt-5">
            <h3 className="font-sans text-lg font-bold">{item.title}</h3>
            <p className="text-linen mt-2">{item.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
