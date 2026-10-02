import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { checkMessages, type FlatCatalogs } from "./check";
import { locales } from "./config";
import { parseRich } from "./format";
import { catalogs } from "./messages";
import { createTranslator, formatCurrency, formatDate, formatNumber } from "./translator";
import { NBSP } from "./typo";
import type { MessageKey } from "./messages";

function flat(): FlatCatalogs {
  return Object.fromEntries(
    locales.map((l) => [l, Object.fromEntries(catalogs[l])]),
  ) as FlatCatalogs;
}

describe("překladové soubory", () => {
  it("cs a en mají stejné klíče, značky a zástupné znaky, bez typografických chyb", () => {
    const { errors } = checkMessages(flat());
    expect(errors).toEqual([]);
  });

  it("chybějící klíč v angličtině je chyba (parita klíčů)", () => {
    const data = flat();
    delete data.en["common.brand"];
    expect(checkMessages(data).errors).toContain("[en] chybí klíč common.brand (je v cs)");
  });

  it("přebývající klíč v angličtině je chyba", () => {
    const data = flat();
    data.en["common.extra"] = "Extra";
    expect(checkMessages(data).errors.join("\n")).toContain("common.extra");
  });

  it("prázdný text je chyba", () => {
    const data = flat();
    data.en["common.brand"] = " ";
    expect(checkMessages(data).errors.join("\n")).toContain("prázdný text");
  });

  it("různé zástupné znaky nebo značky jsou chyba", () => {
    const data = flat();
    data.cs["common.x"] = "Ahoj {name}";
    data.en["common.x"] = "Hello";
    data.cs["common.y"] = "Text <b>tučně</b>";
    data.en["common.y"] = "Text";
    const errors = checkMessages(data).errors.join("\n");
    expect(errors).toContain("common.x: zástupné znaky se liší");
    expect(errors).toContain("common.y: značky se liší");
  });

  it("nepovolená značka a rovná uvozovka jsou chyba", () => {
    const data = flat();
    data.cs["common.z"] = 'Říká "ahoj" <script>';
    data.en["common.z"] = "Says hello";
    const errors = checkMessages(data).errors.join("\n");
    expect(errors).toContain("nepovolená značka <script>");
    expect(errors).toContain("rovná uvozovka");
  });

  it("čeština vyžaduje čtyři množné tvary", () => {
    const data = flat();
    data.cs["catalog.guests"] = { one: "{count} host", other: "{count} hostů" };
    expect(checkMessages(data).errors.join("\n")).toContain('chybí množný tvar "few"');
  });

  it("nepoužité klíče jsou jen varování", () => {
    const result = checkMessages(flat(), new Set());
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("t()", () => {
  it("vrací text v jazyce a aplikuje typografii", () => {
    const cs = createTranslator("cs");
    expect(cs("landing.hero.lead")).toContain(`i${NBSP}praktické`);
    expect(createTranslator("en")("common.skipToContent")).toBe("Skip to content");
  });

  it("množná čísla češtiny mají čtyři tvary přes Intl.PluralRules", () => {
    const t = createTranslator("cs");
    expect(t("catalog.guests", { count: 1 })).toBe(`1${NBSP}host`);
    expect(t("catalog.guests", { count: 3 })).toBe(`3${NBSP}hosté`);
    expect(t("catalog.guests", { count: 1.5 })).toBe(`1,5${NBSP}hosta`);
    expect(t("catalog.guests", { count: 60 })).toBe(`60${NBSP}hostů`);
  });

  it("množná čísla angličtiny", () => {
    const t = createTranslator("en");
    expect(t("catalog.guests", { count: 1 })).toBe(`1${NBSP}guest`);
    expect(t("catalog.guests", { count: 2 })).toBe(`2${NBSP}guests`);
  });

  it("nikdy nezobrazí klíč: chybějící překlad padá na druhý jazyk", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const key = "common.onlyCs" as MessageKey;
    catalogs.cs.set(key, "Jen česky");
    try {
      expect(createTranslator("en")(key)).toBe("Jen česky");
      expect(error).toHaveBeenCalled();
    } finally {
      catalogs.cs.delete(key);
    }
  });

  it("neznámý klíč vrací prázdný text, ne klíč", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(createTranslator("cs")("common.neexistuje" as MessageKey)).toBe("");
  });

  it("rich mapuje jen povolené značky na komponenty a hodnoty parametrů nevytvářejí značky", () => {
    const key = "common.rich" as MessageKey;
    catalogs.cs.set(key, "Ahoj <b>{name}</b> a <i>ahoj</i>");
    try {
      const t = createTranslator("cs");
      const html = renderToStaticMarkup(
        <p>{t.rich(key, { b: (c) => <strong>{c}</strong> }, { name: "<script>" })}</p>,
      );
      expect(html).toBe(`<p>Ahoj <strong>&lt;script&gt;</strong> a${NBSP}ahoj</p>`);
    } finally {
      catalogs.cs.delete(key);
    }
  });
});

describe("parseRich()", () => {
  it("rozdělí text na části", () => {
    expect(parseRich("a <b>b</b> c")).toEqual(["a ", { tag: "b", text: "b" }, " c"]);
    expect(parseRich("bez značek")).toEqual(["bez značek"]);
  });
});

describe("formátování přes Intl", () => {
  it("číslo, měna a datum s nezlomitelnými mezerami", () => {
    expect(formatNumber(12000, "cs")).toBe(`12${NBSP}000`);
    expect(formatNumber(2.5, "cs")).toBe("2,5");
    expect(formatCurrency(990, "cs")).toBe(`990${NBSP}Kč`);
    expect(formatDate(new Date(2026, 9, 1), "cs")).toBe(`1.${NBSP}10.${NBSP}2026`);
  });
});
