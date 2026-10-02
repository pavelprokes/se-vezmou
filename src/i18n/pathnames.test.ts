import { describe, expect, it } from "vitest";
import { hreflangAlternates, languageUrls, localizedPath, matchPathname } from "./pathnames";

describe("pathnames", () => {
  it("čeština je na /, angličtina pod /en", () => {
    expect(localizedPath("home", "cs")).toBe("/");
    expect(localizedPath("home", "en")).toBe("/en");
  });

  it("languageUrls vrací cs, en a x-default na českou verzi", () => {
    expect(languageUrls("home", "https://se-vezmou.cz")).toEqual({
      cs: "https://se-vezmou.cz/",
      en: "https://se-vezmou.cz/en",
      "x-default": "https://se-vezmou.cz/",
    });
  });

  it("hreflangAlternates má canonical na sebe", () => {
    expect(hreflangAlternates("home", "en", "https://se-vezmou.cz").canonical).toBe(
      "https://se-vezmou.cz/en",
    );
    expect(hreflangAlternates("home", "cs", "https://se-vezmou.cz").canonical).toBe(
      "https://se-vezmou.cz/",
    );
  });

  it("matchPathname najde stránku a jazyk, neznámé cesty ne", () => {
    expect(matchPathname("/")).toEqual({ route: "home", locale: "cs" });
    expect(matchPathname("/en/")).toEqual({ route: "home", locale: "en" });
    expect(matchPathname("/cs")).toBeNull();
    expect(matchPathname("/neco")).toBeNull();
  });
});
