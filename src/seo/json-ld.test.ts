import { describe, expect, it } from "vitest";
import { getFaqItems } from "@/components/landing/faq";
import { pricing } from "@/config/pricing";
import { locales } from "@/i18n/config";
import { NBSP } from "@/i18n/typo";
import {
  breadcrumbLd,
  faqPageLd,
  graph,
  organizationLd,
  plain,
  serializeJsonLd,
  softwareApplicationLd,
  websiteLd,
} from "./json-ld";

const siteUrl = "https://se-vezmou.cz";

describe("serializeJsonLd", () => {
  it("escapuje < kvůli vložení do <script> (XSS)", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c/script>");
    expect(JSON.parse(out)).toEqual({ name: "</script><script>alert(1)</script>" });
  });

  it("escapuje oddělovače řádků U+2028 a U+2029", () => {
    const out = serializeJsonLd({
      text: `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`,
    });
    expect(out).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(out).text).toBe(
      `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`,
    );
  });
});

describe("plain", () => {
  it("nahradí nezlomitelné mezery obyčejnými", () => {
    expect(plain(`v${NBSP}klidu`)).toBe("v klidu");
  });
});

describe("Organization", () => {
  const input = {
    siteUrl,
    name: "Se vezmou",
    description: "Popis",
    legalName: "[PROVOZOVATEL, IČO]",
    contact: "[KONTAKT]",
  };

  it("zástupné údaje provozovatele a kontaktu nevypisuje", () => {
    const node = organizationLd(input);
    expect(node).toMatchObject({ "@type": "Organization", name: "Se vezmou", url: `${siteUrl}/` });
    expect(node).not.toHaveProperty("legalName");
    expect(node).not.toHaveProperty("contactPoint");
  });

  it("skutečné údaje vypíše", () => {
    const node = organizationLd({
      ...input,
      legalName: "Novák s.r.o., 12345678",
      contact: "info@se-vezmou.cz",
    });
    expect(node.legalName).toBe("Novák s.r.o., 12345678");
    expect(node.contactPoint).toMatchObject({ email: "info@se-vezmou.cz" });
  });
});

describe("WebSite", () => {
  it("nese jazyk stránky a odkazuje na vydavatele", () => {
    const node = websiteLd({ siteUrl, name: "Se vezmou", description: "Popis", locale: "en" });
    expect(node).toMatchObject({
      "@type": "WebSite",
      inLanguage: "en-GB",
      publisher: { "@id": `${siteUrl}/#organization` },
    });
  });
});

describe("SoftwareApplication", () => {
  const input = {
    siteUrl,
    name: "Se vezmou",
    description: "Popis",
    offerDescription: "Po dobu zaváděcího provozu zdarma.",
    locale: "cs" as const,
    pricing,
  };

  it("cena nabídky je z konfigurace (0 Kč) a nese text o zaváděcím provozu", () => {
    const node = softwareApplicationLd(input);
    expect(node["@type"]).toBe("SoftwareApplication");
    expect(node.offers).toMatchObject({
      "@type": "Offer",
      price: String(pricing.plans[0].price),
      priceCurrency: pricing.currency,
      description: "Po dobu zaváděcího provozu zdarma.",
    });
  });

  it("bez určeného konce provozu nepíše priceValidUntil", () => {
    expect(softwareApplicationLd(input).offers).not.toHaveProperty("priceValidUntil");
  });

  it("po určení konce provozu ho vypíše", () => {
    const node = softwareApplicationLd({
      ...input,
      pricing: { ...pricing, introEndsOn: "2027-06-30" },
    });
    expect(node.offers).toMatchObject({ priceValidUntil: "2027-06-30" });
  });

  it("cena sleduje změnu konfigurace", () => {
    const node = softwareApplicationLd({
      ...input,
      pricing: { ...pricing, plans: [{ id: "concept", price: 149, highlighted: false }] },
    });
    expect(node.offers).toMatchObject({ price: "149" });
  });
});

describe("FAQPage", () => {
  for (const locale of locales) {
    it(`${locale}: šest otázek se stejným textem jako viditelné FAQ`, async () => {
      const items = await getFaqItems(locale);
      expect(items).toHaveLength(6);
      const node = faqPageLd(items.map((i) => ({ question: i.question, answer: i.answer })));
      const entities = node.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
      expect(entities.map((e) => e.name)).toEqual(items.map((i) => plain(i.question)));
      expect(entities.map((e) => e.acceptedAnswer.text)).toEqual(items.map((i) => plain(i.answer)));
      for (const entity of entities) expect(entity.acceptedAnswer.text).not.toContain(NBSP);
    });

    it(`${locale}: odpověď o ceně slibuje oznámení předem, ne „navždy“, a nemá zástupný text`, async () => {
      const [price] = await getFaqItems(locale);
      expect(price.answer).toMatch(/předem|in advance/);
      expect(price.answer).not.toMatch(/\[[^\]]+\]/);
      expect(price.answer).not.toMatch(/navždy|forever/i);
    });
  }
});

describe("BreadcrumbList", () => {
  it("číslovaná cesta od úvodní stránky", () => {
    const node = breadcrumbLd([
      { name: "Úvodní stránka", url: `${siteUrl}/` },
      { name: "Soukromí", url: `${siteUrl}/soukromi` },
    ]);
    expect(node.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Úvodní stránka", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: "Soukromí", item: `${siteUrl}/soukromi` },
    ]);
  });
});

describe("graph", () => {
  it("má jeden @context a uzly v @graph", () => {
    const doc = graph({ "@type": "WebSite" }, { "@type": "Organization" });
    expect(doc["@context"]).toBe("https://schema.org");
    expect(doc["@graph"]).toHaveLength(2);
  });

  it("Review se ve zdrojích strukturovaných dat nikde nevypisuje (skutečné reference zatím nejsou)", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files = [
      join(import.meta.dirname, "json-ld.ts"),
      ...readdirSync(join(import.meta.dirname, "../components/landing"))
        .filter((name) => /\.tsx?$/.test(name))
        .map((name) => join(import.meta.dirname, "../components/landing", name)),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/["'`]@type["'`]\s*:\s*["'`](Review|AggregateRating)["'`]/);
    }
  });
});
