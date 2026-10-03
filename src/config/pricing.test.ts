import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { pickMessages } from "@/i18n/load";
import { operator, isPlaceholder } from "./operator";
import { lowestPrice, pricing, PLAN_IDS } from "./pricing";

/** Texty úvodní stránky (jmenné prostory `landing` a `marketing`) v každém jazyce. */
const catalogs = Object.fromEntries(
  await Promise.all(
    locales.map(async (locale) => [locale, await pickMessages(locale, ["landing", "marketing"])]),
  ),
) as Record<(typeof locales)[number], Record<string, string | Record<string, string>>>;

describe("config/pricing", () => {
  it("obě karty ceny stojí 0 Kč po dobu zaváděcího provozu", () => {
    expect(pricing.currency).toBe("CZK");
    expect(pricing.plans.map((plan) => plan.id)).toEqual([...PLAN_IDS]);
    expect(pricing.plans).toHaveLength(2);
    for (const plan of pricing.plans) expect(plan.price).toBe(0);
  });

  it("zvýrazněná je právě jedna karta (zveřejněný web)", () => {
    const highlighted = pricing.plans.filter((plan) => plan.highlighted);
    expect(highlighted.map((plan) => plan.id)).toEqual(["published"]);
  });

  it("podmínky po skončení zaváděcího provozu jsou zástupný text", () => {
    expect(pricing.conditionsPlaceholder).toBe("[PODMÍNKY]");
    expect(isPlaceholder(pricing.conditionsPlaceholder)).toBe(true);
  });

  it("konec zaváděcího provozu zatím není určen", () => {
    expect(pricing.introEndsOn).toBeNull();
  });

  it("lowestPrice bere nejnižší cenu z karet", () => {
    expect(lowestPrice()).toBe(0);
    expect(
      lowestPrice({ ...pricing, plans: [{ id: "concept", price: 99, highlighted: false }] }),
    ).toBe(99);
  });
});

describe("config/operator", () => {
  it("provozovatel i kontakt jsou doplněné", () => {
    expect(operator.nameAndId).toBe("Pavel Prokeš, IČO 87877601");
    expect(operator.address).toBe("Křižíkova 424/127, Praha 8");
    expect(operator.contact).toBe("info@se-vezmou.cz");
    expect(isPlaceholder(operator.nameAndId)).toBe(false);
    expect(isPlaceholder(operator.contact)).toBe(false);
    expect(isPlaceholder("Novák s.r.o., 12345678")).toBe(false);
  });
});

describe("texty ceny", () => {
  it("nikdy neslibují „zdarma navždy“ (česky ani anglicky)", () => {
    const forbidden = /navždy|\bforever\b|\bfor ever\b|\bfor life\b|\blifetime\b/i;
    for (const locale of locales) {
      for (const [key, value] of Object.entries(catalogs[locale])) {
        const text = typeof value === "string" ? value : Object.values(value).join(" ");
        expect(text, `${locale} ${key}`).not.toMatch(forbidden);
      }
    }
  });

  it("nabídka je vždy vázaná na zaváděcí provoz", () => {
    expect(catalogs.cs["landing.pricing.title"]).toContain("po dobu zaváděcího provozu");
    expect(catalogs.en["landing.pricing.title"]).toContain("during the launch period");
  });
});
