import { describe, expect, it } from "vitest";
import { parseSensitiveLeniently } from "./guest-context";

describe("parseSensitiveLeniently", () => {
  it("neplatná část (IBAN) se vynechá, ostatní části zůstanou", () => {
    const parsed = parseSensitiveLeniently({
      venues: { v1: { address: "Altánová 7" } },
      gifts: { account: "19-2000145399/0800", iban: "CZ00 neplatny" },
    });
    expect(parsed.gifts).toBeNull();
    expect(parsed.venues.v1.address).toBe("Altánová 7");
    expect(parsed.photos).toEqual([]);
  });

  it("chybějící nebo nesmyslný vstup dá prázdnou citlivou část", () => {
    expect(parseSensitiveLeniently(null)).toEqual({
      venues: {},
      gallery: null,
      photos: [],
      gifts: null,
    });
    expect(parseSensitiveLeniently("x")).toEqual({
      venues: {},
      gallery: null,
      photos: [],
      gifts: null,
    });
  });
});
