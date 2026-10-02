import { pricing } from "@/config/pricing";
import type { Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

/**
 * Šest otázek FAQ. Jediný zdroj pro viditelný seznam i strukturovaná data `FAQPage`,
 * takže se značky nikdy nerozejdou s textem.
 */
export function getFaqItems(locale: Locale): FaqItem[] {
  const t = createTranslator(locale);
  const params = { conditions: pricing.conditionsPlaceholder };
  return [
    {
      id: "price",
      question: t("landing.faq.1.q"),
      answer: t("landing.faq.1.a", params),
    },
    { id: "account", question: t("landing.faq.2.q"), answer: t("landing.faq.2.a") },
    { id: "google", question: t("landing.faq.3.q"), answer: t("landing.faq.3.a") },
    { id: "login", question: t("landing.faq.4.q"), answer: t("landing.faq.4.a") },
    { id: "draft", question: t("landing.faq.5.q"), answer: t("landing.faq.5.a") },
    { id: "guest-data", question: t("landing.faq.6.q"), answer: t("landing.faq.6.a") },
  ];
}
