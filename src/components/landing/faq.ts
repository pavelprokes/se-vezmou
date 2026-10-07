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

/** Otázky ke stránce pro fotografy; stejný zdroj pro viditelný seznam i `FAQPage`. */
export async function getPhotographerFaqItems(locale: Locale): Promise<FaqItem[]> {
  const t = await getTranslator(locale, ["marketing"]);
  return ([1, 2, 3] as const).map((n) => ({
    id: `photographers-${n}`,
    question: t(`marketing.photographers.faq.${n}.q`),
    answer: t(`marketing.photographers.faq.${n}.a`),
  }));
}

/** Otázky ke stránce šablon; stejný zdroj pro viditelný seznam i `FAQPage`. */
export async function getTemplateFaqItems(locale: Locale): Promise<FaqItem[]> {
  const t = await getTranslator(locale, ["marketing"]);
  return ([1, 2, 3, 4, 5, 6] as const).map((n) => ({
    id: `template-${n}`,
    question: t(`marketing.templates.faq.${n}.q`),
    answer: t(`marketing.templates.faq.${n}.a`),
  }));
}

/** Otázky ke stránce dvojjazyčného webu (hosté ze zahraničí, svatba v Česku); stejný zdroj pro seznam i `FAQPage`. */
export async function getBilingualFaqItems(locale: Locale): Promise<FaqItem[]> {
  const t = await getTranslator(locale, ["marketing"]);
  return ([1, 2, 3, 4, 5] as const).map((n) => ({
    id: `bilingual-${n}`,
    question: t(`marketing.bilingual.faq.${n}.q`),
    answer: t(`marketing.bilingual.faq.${n}.a`),
  }));
}
