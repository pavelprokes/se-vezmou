import { isPlaceholder } from "@/config/operator";
import { lowestPrice, type Pricing } from "@/config/pricing";
import { htmlLang, type Locale, locales } from "@/i18n/config";

/**
 * Strukturovaná data (JSON-LD, technical-design 6.3). Čisté funkce bez Reactu: dostanou stejné
 * texty a čísla jako viditelná stránka, takže se značky nikdy nerozejdou s obsahem.
 *
 * `Review` se záměrně nevypisuje: skutečné reference zatím nejsou (test to hlídá).
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
  /** Doména jako druhý název (logo v hlavičce je adresa webu). */
  alternateName?: string;
  /** Obchodní jméno; zástupná hodnota se do dat nepíše. */
  legalName: string;
  /** IČO; bez něj se `identifier` nepíše. */
  companyId?: string;
  /** Kontakt; zástupná hodnota se do dat nepíše. */
  contact: string;
  /** Profily značky (`sameAs`); prázdné se nepíšou. */
  profiles?: readonly string[];
}

const idOf = (siteUrl: string, fragment: string) => `${siteUrl}/#${fragment}`;

export function organizationLd(input: OrganizationInput): JsonLdNode {
  const node: JsonLdNode = {
    "@type": "Organization",
    "@id": idOf(input.siteUrl, "organization"),
    name: plain(input.name),
    url: `${input.siteUrl}/`,
    description: plain(input.description),
    logo: `${input.siteUrl}/icons/icon-512.png`,
  };
  if (input.alternateName) node.alternateName = input.alternateName;
  if (!isPlaceholder(input.legalName)) node.legalName = plain(input.legalName);
  if (input.companyId) {
    node.identifier = { "@type": "PropertyValue", propertyID: "IČO", value: input.companyId };
  }
  if (input.profiles?.length) node.sameAs = [...input.profiles];
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
  /** Druh služby pro uzel `Service` (přeložený text, např. „Svatební web“). */
  serviceType: string;
  locale: Locale;
  pricing: Pricing;
}

function offerLd(input: SoftwareApplicationInput): JsonLdNode {
  const offer: JsonLdNode = {
    "@type": "Offer",
    price: String(lowestPrice(input.pricing)),
    priceCurrency: input.pricing.currency,
    description: plain(input.offerDescription),
    availability: "https://schema.org/InStock",
  };
  // Konec zaváděcího provozu zatím není určen; bez něj `priceValidUntil` nepíšeme.
  if (input.pricing.introEndsOn) offer.priceValidUntil = input.pricing.introEndsOn;
  return offer;
}

export function softwareApplicationLd(input: SoftwareApplicationInput): JsonLdNode {
  return {
    "@type": "SoftwareApplication",
    "@id": idOf(input.siteUrl, "software"),
    name: plain(input.name),
    url: `${input.siteUrl}/`,
    description: plain(input.description),
    applicationCategory: "LifestyleApplication",
    operatingSystem: "Web",
    inLanguage: ["cs", "en-GB"],
    offers: offerLd(input),
    publisher: { "@id": idOf(input.siteUrl, "organization") },
  };
}

/**
 * Tatáž služba jako `Service` (nabídka s cenou, poskytovatel, území): `SoftwareApplication` popisuje aplikaci,
 * `Service` to, co pár dostane. Cena i text nabídky jsou ze stejných vstupů, takže se uzly nerozejdou.
 */
export function serviceLd(input: SoftwareApplicationInput): JsonLdNode {
  return {
    "@type": "Service",
    "@id": idOf(input.siteUrl, "service"),
    name: plain(input.name),
    serviceType: plain(input.serviceType),
    url: `${input.siteUrl}/`,
    description: plain(input.description),
    // ISO 3166-1: stejná hodnota v každém jazyce, ať se uzel nerozchází mezi jazykovými verzemi.
    areaServed: { "@type": "Country", name: "CZ" },
    isRelatedTo: { "@id": idOf(input.siteUrl, "software") },
    offers: offerLd(input),
    provider: { "@id": idOf(input.siteUrl, "organization") },
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

export interface BlogPostingInput {
  siteUrl: string;
  url: string;
  headline: string;
  description: string;
  locale: Locale;
  /** `YYYY-MM-DD`. */
  datePublished: string;
  dateModified: string;
  imageUrl: string;
  /** Autor článku (osoba provozovatele). */
  authorName: string;
}

/**
 * Článek blogu: autorem je osoba provozovatele, vydavatelem `Organization` ze stejného grafu.
 * `speakable` ukazuje na nadpis a perex (`#article-title`, `#article-lead` na stránce článku).
 */
export function blogPostingLd(input: BlogPostingInput): JsonLdNode {
  const organization = { "@id": idOf(input.siteUrl, "organization") };
  return {
    "@type": "BlogPosting",
    "@id": `${input.url}#article`,
    mainEntityOfPage: input.url,
    url: input.url,
    headline: plain(input.headline),
    description: plain(input.description),
    inLanguage: htmlLang[input.locale],
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    image: input.imageUrl,
    author: {
      "@type": "Person",
      "@id": idOf(input.siteUrl, "author"),
      name: plain(input.authorName),
      worksFor: organization,
    },
    publisher: organization,
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: ["#article-title", "#article-lead"],
    },
    isPartOf: { "@id": idOf(input.siteUrl, "website") },
  };
}

export interface WebPageInput {
  siteUrl: string;
  url: string;
  name: string;
  description: string;
  locale: Locale;
  /** `YYYY-MM-DD`, stejné datum jako viditelné „Aktualizováno“. */
  dateModified: string;
}

/** Podstránka úvodního webu: datum aktualizace a `speakable` na nadpis a úvodní větu (`#page-title`, `#page-lead`). */
export function webPageLd(input: WebPageInput): JsonLdNode {
  return {
    "@type": "WebPage",
    "@id": `${input.url}#webpage`,
    url: input.url,
    name: plain(input.name),
    description: plain(input.description),
    inLanguage: htmlLang[input.locale],
    dateModified: input.dateModified,
    isPartOf: { "@id": idOf(input.siteUrl, "website") },
    publisher: { "@id": idOf(input.siteUrl, "organization") },
    speakable: { "@type": "SpeakableSpecification", cssSelector: ["#page-title", "#page-lead"] },
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
