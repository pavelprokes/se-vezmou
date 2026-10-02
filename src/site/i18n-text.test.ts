import { describe, expect, it } from "vitest";
import { missingLocales, pick, resolvedLocale } from "./i18n-text";

describe("pick: náhradní jazyk", () => {
  const both = { cs: "Obřad", en: "Ceremony" };

  it("vrací požadovaný jazyk", () => {
    expect(pick(both, "en", "cs")).toBe("Ceremony");
    expect(pick(both, "cs", "en")).toBe("Obřad");
  });

  it("chybějící překlad nahradí výchozím jazykem webu", () => {
    expect(pick({ cs: "Obřad" }, "en", "cs")).toBe("Obřad");
    expect(pick({ en: "Ceremony" }, "cs", "en")).toBe("Ceremony");
  });

  it("prázdný nebo prázdnými znaky vyplněný překlad bere jako chybějící", () => {
    expect(pick({ cs: "Obřad", en: "   " }, "en", "cs")).toBe("Obřad");
    expect(pick({ cs: "", en: "Ceremony" }, "cs", "cs")).toBe("Ceremony");
  });

  it("když chybí výchozí i požadovaný, použije libovolný dostupný", () => {
    expect(pick({ en: "Ceremony" }, "cs", "cs")).toBe("Ceremony");
  });

  it("bez textu vrací prázdný řetězec, nikdy klíč ani undefined", () => {
    expect(pick({}, "cs", "cs")).toBe("");
    expect(pick(null, "cs", "cs")).toBe("");
    expect(pick(undefined, "en", "cs")).toBe("");
  });

  it("resolvedLocale říká, v jakém jazyce se text skutečně zobrazí", () => {
    expect(resolvedLocale({ cs: "a", en: "b" }, "en", "cs")).toBe("en");
    expect(resolvedLocale({ cs: "a" }, "en", "cs")).toBe("cs");
    expect(resolvedLocale({}, "en", "cs")).toBeNull();
    expect(resolvedLocale(null, "en", "cs")).toBeNull();
  });

  it("missingLocales vypíše jazyky webu bez překladu (hlášení správci)", () => {
    expect(missingLocales({ cs: "a" }, ["cs", "en"])).toEqual(["en"]);
    expect(missingLocales({ cs: "a", en: "b" }, ["cs", "en"])).toEqual([]);
    expect(missingLocales(null, ["cs"])).toEqual(["cs"]);
    expect(missingLocales({ cs: "a" }, ["cs"])).toEqual([]);
  });
});
