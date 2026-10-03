import { describe, expect, it } from "vitest";
import { listHref, parseListQuery, toFilters } from "./list-query";
import { defaultLocale, locales } from "@/i18n/config";

describe("parseListQuery", () => {
  it("načte platné filtry", () => {
    expect(
      parseListQuery({
        stav: "published",
        jazyk: "cs",
        sablona: "modern",
        mesic: "2027-06",
        q: "  klara  ",
        strana: "3",
      }),
    ).toEqual({
      status: "published",
      locale: "cs",
      template: "modern",
      month: "2027-06",
      query: "klara",
      page: 3,
    });
  });

  it("neplatné hodnoty tiše zahodí", () => {
    expect(
      parseListQuery({
        stav: "nic",
        jazyk: "de",
        sablona: "x",
        mesic: "2027-13",
        q: "   ",
        strana: "-4",
      }),
    ).toEqual({ page: 1 });
    expect(parseListQuery({ strana: "1.5" }).page).toBe(1);
    expect(parseListQuery({ strana: "abc" }).page).toBe(1);
    expect(parseListQuery({ strana: "99999999" }).page).toBe(1);
  });

  it("opakovaný parametr bere první hodnotu", () => {
    expect(parseListQuery({ stav: ["draft", "blocked"] }).status).toBe("draft");
  });

  it("omezí délku hledání", () => {
    expect(parseListQuery({ q: "x".repeat(500) }).query).toHaveLength(100);
  });
});

describe("toFilters a listHref", () => {
  it("měsíc převede na první den a stránku na posun", () => {
    const filters = toFilters({ month: "2027-06", page: 3, status: "draft" });
    expect(filters).toMatchObject({ month: "2027-06-01", offset: 50, limit: 25, status: "draft" });
  });

  it("sestaví adresu bez prázdných hodnot a bez strany 1", () => {
    expect(listHref({ page: 1 })).toBe("/zakazky");
    expect(listHref({ page: 2, status: "draft", query: "a b" })).toBe(
      "/zakazky?stav=draft&q=a+b&strana=2",
    );
    expect(listHref({ page: 2, status: "draft" }, 1)).toBe("/zakazky?stav=draft");
  });

  it("adresa nese jazyk rozhraní: výchozí bez předpony, ostatní pod /<jazyk>", () => {
    for (const locale of locales) {
      const expected =
        locale === defaultLocale ? "/zakazky?strana=2" : `/${locale}/zakazky?strana=2`;
      expect(listHref({ page: 2 }, 2, locale)).toBe(expected);
    }
  });

  it("adresa a rozbor jsou si inverzní", () => {
    const query = parseListQuery({ stav: "blocked", jazyk: "en", mesic: "2030-05", q: "žofie" });
    const url = new URL(listHref(query, 4), "https://x.test");
    expect(parseListQuery(Object.fromEntries(url.searchParams))).toEqual({ ...query, page: 4 });
  });
});
