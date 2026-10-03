import { isPlaceholder } from "@/config/operator";
import { lowestPrice, type Pricing } from "@/config/pricing";
import { htmlLang, type Locale, locales } from "@/i18n/config";

/**
 * Strukturovaná data (JSON-LD, technical-design 6.3). Čisté funkce bez Reactu: dostanou stejné
 * texty a čísla jako viditelná stránka, takže se značky nikdy nerozejdou s obsahem.
 *
 * `Review` se záměrně nevypisuje: reference jsou zatím zástupný text (test to hlídá).
 */

export type JsonLdNode = Record<string, unknown>;

/** Nezlomitelné mezery z typografie nepatří do strukturovaných dat. */
export function plain(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, " ").trim();
}

/** Serializace do `<script type="application/ld+json">`: `<` a oddělovače řádků se escapují (XSS). */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export interface OrganizationInput {
  siteUrl: string;
  name: string;
  description: string;
  /** Obchodní jméno a IČO; zástupná hodnota se do dat nepíše. */
  legalName: string;
  /** Kontakt; zástupná hodnota se do dat nepíše. */
  contact: string;
}

const idOf = (siteUrl: string, fragment: string) => `${siteUrl}/#${fragment}`;

export function organizationLd(input: OrganizationInput): JsonLdNode {
  const node: JsonLdNode = {
    "@type": "Organization",
    "@id": idOf(input.siteUrl, "organization"),
    name: plain(input.name),
    url: `${input.siteUrl}/`,
    description: plain(input.description),
  };
  if (!isPlaceholder(input.legalName)) node.legalName = plain(input.legalName);
  if (!isPlaceholder(input.contact)) {
    node.contactPoint = {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: plain(input.contact),
      availableLanguage: [...locales],
    };
  }
  return node;
}

export interface WebSiteInput {
  siteUrl: string;
  name: string;
  description: string;
  locale: Locale;
}

export function websiteLd({ siteUrl, name, description, locale }: WebSiteInput): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": idOf(siteUrl, "website"),
    name: plain(name),
    url: `${siteUrl}/`,
    description: plain(description),
    inLanguage: htmlLang[locale],
    publisher: { "@id": idOf(siteUrl, "organization") },
  };
}

export interface SoftwareApplicationInput {
  siteUrl: string;
  name: string;
  description: string;
  /** Text o zaváděcím provozu, který nabídku popisuje (nikdy „zdarma navždy“). */
  offerDescription: string;
  locale: Locale;
  pricing: Pricing;
}

export function softwareApplicationLd(input: SoftwareApplicationInput): JsonLdNode {
  const offer: JsonLdNode = {
    "@type": "Offer",
    price: String(lowestPrice(input.pricing)),
    priceCurrency: input.pricing.currency,
    description: plain(input.offerDescription),
    availability: "https://schema.org/InStock",
  };
  // Konec zaváděcího provozu zatím není určen; bez něj `priceValidUntil` nepíšeme.
  if (input.pricing.introEndsOn) offer.priceValidUntil = input.pricing.introEndsOn;

  return {
    "@type": "SoftwareApplication",
    "@id": idOf(input.siteUrl, "software"),
    name: plain(input.name),
    url: `${input.siteUrl}/`,
    description: plain(input.description),
    applicationCategory: "LifestyleApplication",
    operatingSystem: "Web",
    inLanguage: ["cs", "en-GB"],
    offers: offer,
    publisher: { "@id": idOf(input.siteUrl, "organization") },
  };
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export function faqPageLd(entries: readonly FaqEntry[]): JsonLdNode {
  return {
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: plain(entry.question),
      acceptedAnswer: { "@type": "Answer", text: plain(entry.answer) },
    })),
  };
}

export interface Crumb {
  name: string;
  url: string;
}

export function breadcrumbLd(crumbs: readonly Crumb[]): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: plain(crumb.name),
      item: crumb.url,
    })),
  };
}

/** Uzly spojí do jednoho dokumentu `@graph` s jedním `@context`. */
export function graph(...nodes: JsonLdNode[]): JsonLdNode {
  return { "@context": "https://schema.org", "@graph": nodes };
}
