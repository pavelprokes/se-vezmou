import { describe, expect, it } from "vitest";
import { editorialFixture, eukalyptusFixture, sensitiveFixture } from "./fixtures/klara-a-matej";
import { originFromHeaders, languageAlternates } from "./origin";
import { publicContentSchema, sensitiveContentSchema } from "./types";

describe("schéma PublicContent", () => {
  it("fixtury jsou platné a patří vymyšlenému páru", () => {
    for (const fixture of [eukalyptusFixture, editorialFixture]) {
      expect(publicContentSchema.safeParse(fixture).success).toBe(true);
      expect(fixture.partners).toEqual({ a: "Klára", b: "Matěj" });
      expect(JSON.stringify(fixture)).not.toMatch(/Patric|Pavel/);
    }
    expect(JSON.stringify(sensitiveFixture)).not.toMatch(/Patric|Pavel/);
  });

  it("dvě ukázky používají dvě různé šablony", () => {
    expect(eukalyptusFixture.template).not.toBe(editorialFixture.template);
  });

  it("veřejný snímek neobsahuje číslo účtu ani IBAN (jen citlivý obsah za PINem)", () => {
    const json = JSON.stringify(eukalyptusFixture) + JSON.stringify(editorialFixture);
    expect(json).not.toContain(sensitiveFixture.gifts!.account);
    expect(json).not.toContain(sensitiveFixture.gifts!.iban);
  });

  it("odmítne jazyk mimo cs a en v textu", () => {
    const bad = structuredClone(eukalyptusFixture) as unknown as {
      venues: { name: Record<string, string> }[];
    };
    bad.venues[0].name = { cs: "Kaple", de: "Kapelle" };
    expect(publicContentSchema.safeParse(bad).success).toBe(false);
  });

  it("odmítne odkaz na mapu s nebezpečným schématem", () => {
    const bad = structuredClone(eukalyptusFixture);
    bad.venues[0].mapUrl = "javascript:alert(1)";
    expect(publicContentSchema.safeParse(bad).success).toBe(false);
  });

  it("odmítne výchozí jazyk mimo jazyky webu, neznámou šablonu a neplatnou kotvu", () => {
    expect(
      publicContentSchema.safeParse({ ...eukalyptusFixture, locales: ["en"], defaultLocale: "cs" })
        .success,
    ).toBe(false);
    expect(publicContentSchema.safeParse({ ...eukalyptusFixture, template: "neon" }).success).toBe(
      false,
    );
    const bad = structuredClone(eukalyptusFixture);
    bad.blocks[0].anchor = "Uvod s mezerou";
    expect(publicContentSchema.safeParse(bad).success).toBe(false);
  });

  it("citlivý obsah vyžaduje platný IBAN", () => {
    expect(
      sensitiveContentSchema.safeParse({
        gifts: { account: "1/0100", iban: "CZ0000000000000000000000" },
      }).success,
    ).toBe(false);
  });
});

describe("původ webu a hreflang", () => {
  it("vybere protokol podle hlavičky a lokálního hostitele", () => {
    expect(originFromHeaders("klara-a-matej.se-vezmou.cz", null)).toBe(
      "https://klara-a-matej.se-vezmou.cz",
    );
    expect(originFromHeaders("klara-a-matej.localhost:3100", null)).toBe(
      "http://klara-a-matej.localhost:3100",
    );
    expect(originFromHeaders("x.se-vezmou.cz", "https, http")).toBe("https://x.se-vezmou.cz");
  });

  it("neplatnou hlavičku Host nepřepíše do adres", () => {
    expect(originFromHeaders("evil.example/<script>", null)).toBe("http://localhost");
    expect(originFromHeaders(null, null)).toBe("http://localhost");
  });

  it("hreflang obsahuje jen jazyky webu a x-default na výchozí jazyk", () => {
    expect(languageAlternates("https://a.se-vezmou.cz", ["cs", "en"], "cs")).toEqual({
      cs: "https://a.se-vezmou.cz/",
      en: "https://a.se-vezmou.cz/en",
      "x-default": "https://a.se-vezmou.cz/",
    });
    expect(languageAlternates("https://a.se-vezmou.cz", ["en"], "en")).toEqual({
      en: "https://a.se-vezmou.cz/en",
      "x-default": "https://a.se-vezmou.cz/en",
    });
  });
});
