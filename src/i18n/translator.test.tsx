import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { checkMessages, type FlatCatalogs } from "./check";
import { defaultLocale, locales } from "./config";
import { parseRich } from "./format";
import { getTranslator, loadMessages } from "./load";
import { namespaces, type NamespaceKey } from "./messages";
import {
  createTranslator,
  formatCurrency,
  formatDate,
  formatNumber,
  type LoadedMessages,
} from "./translator";
import { NBSP } from "./typo";

/** Všechny zprávy každého jazyka (bez náhrady z výchozího jazyka), plochě. */
const loaded = Object.fromEntries(
  await Promise.all(
    locales.map(async (locale) => {
      const { messages } = await loadMessages(locale, namespaces);
      const out: Record<string, unknown> = {};
      for (const [namespace, entries] of Object.entries(messages)) {
        for (const [key, value] of Object.entries(entries ?? {}))
          out[`${namespace}.${key}`] = value;
      }
      return [locale, out] as const;
    }),
  ),
);

function flat(): FlatCatalogs {
  return structuredClone(loaded) as FlatCatalogs;
}

/** Translator nad ručně zadanými zprávami (bez souborů). */
function fromMessages(
  locale: (typeof locales)[number],
  own: Record<string, string>,
  fallback?: Record<string, string>,
) {
  const input: LoadedMessages<"common"> = {
    locale,
    namespaces: ["common"],
    messages: { common: own },
    fallback: fallback ? { common: fallback } : undefined,
  };
  return createTranslator(input);
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
  it("vrací text v jazyce a aplikuje typografii", async () => {
    const cs = await getTranslator("cs", ["landing"]);
    expect(cs("landing.hero.lead")).toContain(`i${NBSP}praktické`);
    expect((await getTranslator("en", ["common"]))("common.skipToContent")).toBe("Skip to content");
  });

  it("množná čísla češtiny mají čtyři tvary přes Intl.PluralRules", async () => {
    const t = await getTranslator("cs", ["catalog"]);
    expect(t("catalog.guests", { count: 1 })).toBe(`1${NBSP}host`);
    expect(t("catalog.guests", { count: 3 })).toBe(`3${NBSP}hosté`);
    expect(t("catalog.guests", { count: 1.5 })).toBe(`1,5${NBSP}hosta`);
    expect(t("catalog.guests", { count: 60 })).toBe(`60${NBSP}hostů`);
  });

  it("množná čísla angličtiny", async () => {
    const t = await getTranslator("en", ["catalog"]);
    expect(t("catalog.guests", { count: 1 })).toBe(`1${NBSP}guest`);
    expect(t("catalog.guests", { count: 2 })).toBe(`2${NBSP}guests`);
  });

  it("nikdy nezobrazí klíč: chybějící překlad padá na výchozí jazyk (zalogovaný)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const key = "common.onlyCs" as NamespaceKey<"common">;
    for (const locale of locales.filter((l) => l !== defaultLocale)) {
      expect(fromMessages(locale, {}, { onlyCs: "Jen česky" })(key)).toBe("Jen česky");
    }
    expect(error).toHaveBeenCalledWith(expect.stringContaining("common.onlyCs"));
  });

  it("výchozí jazyk nepadá na jiný jazyk: chybějící klíč je prázdný text", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = fromMessages(defaultLocale, {}, { onlyCs: "Jinde" });
    expect(t("common.onlyCs" as NamespaceKey<"common">)).toBe("");
  });

  it("neznámý klíč vrací prázdný text, ne klíč", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await getTranslator("cs", ["common"]);
    expect(t("common.neexistuje" as NamespaceKey<"common">)).toBe("");
  });

  it("rich mapuje jen povolené značky na komponenty a hodnoty parametrů nevytvářejí značky", () => {
    const t = fromMessages("cs", { rich: "Ahoj <b>{name}</b> a <i>ahoj</i>" });
    const html = renderToStaticMarkup(
      <p>
        {t.rich(
          "common.rich" as NamespaceKey<"common">,
          { b: (c) => <strong>{c}</strong> },
          { name: "<script>" },
        )}
      </p>,
    );
    expect(html).toBe(`<p>Ahoj <strong>&lt;script&gt;</strong> a${NBSP}ahoj</p>`);
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
