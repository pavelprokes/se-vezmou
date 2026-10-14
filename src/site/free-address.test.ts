import { describe, expect, it } from "vitest";
import { slugFromNames } from "@/wizard/slug";
import { addressHost, isFreeAddressCandidate, namesFromSlug } from "./free-address";

describe("isFreeAddressCandidate", () => {
  it("přijme platný tvar adresy", () => {
    for (const slug of ["david-and-lil", "klara-a-matej", "abc", "a1b", "x".repeat(63)]) {
      expect(isFreeAddressCandidate(slug), slug).toBe(true);
    }
  });

  it("odmítne neplatný tvar, rezervovaná slova a blokované výrazy bez dotazu do databáze", () => {
    for (const slug of [
      "",
      "ab",
      "x".repeat(64),
      "-abc",
      "abc-",
      "a--b",
      "ABC",
      "klara_matej",
      "klára",
      "test",
      "www",
      "app",
      "admin",
      "kurva-a-matej",
    ]) {
      expect(isFreeAddressCandidate(slug), slug).toBe(false);
    }
  });
});

describe("addressHost", () => {
  it("vezme doménu z hostitele požadavku, i s portem", () => {
    expect(addressHost("david-and-lil", "david-and-lil.se-vezmou.cz")).toBe(
      "david-and-lil.se-vezmou.cz",
    );
    expect(addressHost("david-and-lil", "david-and-lil.localhost:3000")).toBe(
      "david-and-lil.localhost:3000",
    );
  });

  it("nebezpečný nebo cizí hostitel nahradí výchozí doménou", () => {
    expect(addressHost("david-and-lil", null)).toBe("david-and-lil.se-vezmou.cz");
    expect(addressHost("david-and-lil", "evil.example")).toBe("david-and-lil.se-vezmou.cz");
    expect(addressHost("david-and-lil", "david-and-lil.")).toBe("david-and-lil.se-vezmou.cz");
    expect(addressHost("david-and-lil", "david-and-lil.x<script>")).toBe(
      "david-and-lil.se-vezmou.cz",
    );
    expect(addressHost("david-and-lil", "x.se-vezmou.cz", "se-vezmou.test")).toBe(
      "david-and-lil.se-vezmou.test",
    );
  });
});

describe("namesFromSlug", () => {
  it("rozdělí anglickou adresu na jména v angličtině", () => {
    expect(namesFromSlug("david-and-lil", "en")).toEqual({ first: "David", second: "Lil" });
  });

  it("rozdělí českou adresu na jména v češtině", () => {
    expect(namesFromSlug("david-a-lil", "cs")).toEqual({ first: "David", second: "Lil" });
    expect(namesFromSlug("klara-a-matej", "cs")).toEqual({ first: "Klara", second: "Matej" });
  });

  it("spojka jiného jazyka, než je jazyk stránky, nic nepředvyplní", () => {
    expect(namesFromSlug("david-and-lil", "cs")).toBeNull();
    expect(namesFromSlug("david-a-lil", "en")).toBeNull();
  });

  it("nejednoznačné adresy nepředvyplní", () => {
    for (const slug of [
      "david-lil",
      "david-and-lil-2027",
      "anna-marie-a-jan",
      "david-a-lil-a-eva",
      "david-and-and-lil",
      "d-a-lil",
      "david-a-1",
      "david-a-",
      "a-and-b",
      "svatba",
    ]) {
      expect(namesFromSlug(slug, "cs"), `cs ${slug}`).toBeNull();
      expect(namesFromSlug(slug, "en"), `en ${slug}`).toBeNull();
    }
  });

  it("jména vždy vyrobí přesně tutéž adresu (kontrola opačným směrem)", () => {
    for (const [slug, locale] of [
      ["david-and-lil", "en"],
      ["david-a-lil", "cs"],
      ["ab-a-cd", "cs"],
    ] as const) {
      const names = namesFromSlug(slug, locale);
      expect(names, slug).not.toBeNull();
      expect(slugFromNames(names!.first, names!.second, locale)).toBe(slug);
    }
  });
});
