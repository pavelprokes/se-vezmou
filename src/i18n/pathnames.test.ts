import { describe, expect, it } from "vitest";
import { defaultLocale, locales } from "./config";
import {
  hreflangAlternates,
  languageUrls,
  localizedPath,
  localizedPaths,
  matchPathname,
  pathnames,
  type RouteName,
} from "./pathnames";

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

  it("právní podstránky mají přeložené cesty (cs bez prefixu, en pod /en)", () => {
    expect(localizedPath("privacy", "cs")).toBe("/soukromi");
    expect(localizedPath("privacy", "en")).toBe("/en/privacy");
    expect(localizedPath("terms", "cs")).toBe("/podminky");
    expect(localizedPath("terms", "en")).toBe("/en/terms");
    expect(localizedPath("accessibility", "cs")).toBe("/dostupnost");
    expect(localizedPath("accessibility", "en")).toBe("/en/accessibility");
    expect(matchPathname("/en/privacy")).toEqual({ route: "privacy", locale: "en" });
    expect(matchPathname("/privacy")).toBeNull();
    expect(matchPathname("/en/soukromi")).toBeNull();
  });

  it("hreflang právní stránky odkazuje na obě verze a x-default na českou", () => {
    expect(languageUrls("privacy", "https://se-vezmou.cz")).toEqual({
      cs: "https://se-vezmou.cz/soukromi",
      en: "https://se-vezmou.cz/en/privacy",
      "x-default": "https://se-vezmou.cz/soukromi",
    });
  });

  it("každá stránka má cestu v každém jazyce: výchozí bez předpony, ostatní pod /<jazyk>", () => {
    for (const route of Object.keys(pathnames) as RouteName[]) {
      const paths = localizedPaths(route);
      expect(Object.keys(paths).sort()).toEqual([...locales].sort());
      for (const locale of locales) {
        const path = paths[locale];
        if (locale === defaultLocale) {
          expect(locales.some((l) => path === `/${l}` || path.startsWith(`/${l}/`))).toBe(false);
        } else {
          expect(path === `/${locale}` || path.startsWith(`/${locale}/`)).toBe(true);
        }
        expect(matchPathname(path)).toEqual({ route, locale });
      }
      const urls = languageUrls(route, "https://se-vezmou.cz");
      expect(Object.keys(urls).sort()).toEqual([...locales, "x-default"].sort());
      expect(urls["x-default"]).toBe(urls[defaultLocale]);
    }
  });

  it("matchPathname najde stránku a jazyk, neznámé cesty ne", () => {
    expect(matchPathname("/")).toEqual({ route: "home", locale: "cs" });
    expect(matchPathname("/en/")).toEqual({ route: "home", locale: "en" });
    expect(matchPathname("/cs")).toBeNull();
    expect(matchPathname("/neco")).toBeNull();
  });
});
