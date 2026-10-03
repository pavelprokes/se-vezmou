import { describe, expect, it } from "vitest";
import {
  defaultLocale,
  htmlLang,
  intlLocale,
  isLocale,
  localeNames,
  localePath,
  localeShortNames,
  locales,
  splitLocalePath,
  toLocale,
} from "./config";

const others = locales.filter((l) => l !== defaultLocale);

describe("konfigurace jazyků", () => {
  it("výchozí jazyk je čeština a je mezi jazyky", () => {
    expect(defaultLocale).toBe("cs");
    expect(locales).toContain(defaultLocale);
  });

  it("tabulky po jazycích jsou úplné", () => {
    for (const table of [htmlLang, intlLocale, localeNames, localeShortNames]) {
      expect(Object.keys(table).sort()).toEqual([...locales].sort());
    }
  });

  it("isLocale a toLocale: neznámá hodnota je výchozí jazyk", () => {
    for (const locale of locales) {
      expect(isLocale(locale)).toBe(true);
      expect(toLocale(locale)).toBe(locale);
    }
    for (const value of ["de", "", "EN", null, undefined]) {
      expect(isLocale(value)).toBe(false);
      expect(toLocale(value)).toBe(defaultLocale);
    }
  });
});

describe("localePath a splitLocalePath", () => {
  it("výchozí jazyk bez předpony, ostatní pod /<jazyk>", () => {
    expect(localePath("/", defaultLocale)).toBe("/");
    expect(localePath("/web", defaultLocale)).toBe("/web");
    for (const locale of others) {
      expect(localePath("/", locale)).toBe(`/${locale}`);
      expect(localePath("/web?x=1", locale)).toBe(`/${locale}/web?x=1`);
    }
  });

  it("splitLocalePath je opak localePath", () => {
    for (const locale of locales) {
      for (const path of ["/", "/web", "/hoste/import"]) {
        expect(splitLocalePath(localePath(path, locale))).toEqual({ locale, path });
      }
    }
  });

  it("předpona výchozího jazyka je duplicita, neznámá předpona není jazyk", () => {
    expect(splitLocalePath(`/${defaultLocale}`)).toBeNull();
    expect(splitLocalePath(`/${defaultLocale}/web`)).toBeNull();
    expect(splitLocalePath("/de/web")).toEqual({ locale: defaultLocale, path: "/de/web" });
    for (const locale of others) {
      expect(splitLocalePath(`/${locale}x`)).toEqual({
        locale: defaultLocale,
        path: `/${locale}x`,
      });
      expect(splitLocalePath(`/${locale}/`)).toEqual({ locale, path: "/" });
    }
  });
});
