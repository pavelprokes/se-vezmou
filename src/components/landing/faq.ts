import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

/**
 * Šest otázek FAQ. Jediný zdroj pro viditelný seznam i strukturovaná data `FAQPage`,
 * takže se značky nikdy nerozejdou s textem.
 */
export async function getFaqItems(locale: Locale): Promise<FaqItem[]> {
  const t = await getTranslator(locale, ["landing"]);
  return [
    {
      id: "price",
      question: t("landing.faq.1.q"),
      answer: t("landing.faq.1.a"),
    },
    { id: "account", question: t("landing.faq.2.q"), answer: t("landing.faq.2.a") },
    { id: "google", question: t("landing.faq.3.q"), answer: t("landing.faq.3.a") },
    { id: "login", question: t("landing.faq.4.q"), answer: t("landing.faq.4.a") },
    { id: "draft", question: t("landing.faq.5.q"), answer: t("landing.faq.5.a") },
    { id: "guest-data", question: t("landing.faq.6.q"), answer: t("landing.faq.6.a") },
  ];
}
