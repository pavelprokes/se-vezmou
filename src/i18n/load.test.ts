import { describe, expect, it, vi } from "vitest";
import { defaultLocale, locales } from "./config";
import { getTranslator, loadMessages, loaders, pickMessages } from "./load";
import { namespaces, type Namespace } from "./messages";

const others = locales.filter((l) => l !== defaultLocale);

/** Sleduje každý loader (jazyk × jmenný prostor) a vrátí seznam načtených dvojic. */
function spyAll() {
  const calls: string[] = [];
  for (const locale of locales) {
    for (const namespace of namespaces) {
      const original = loaders[locale][namespace];
      vi.spyOn(loaders[locale], namespace).mockImplementation(() => {
        calls.push(`${locale}/${namespace}`);
        return original();
      });
    }
  }
  return calls;
}

describe("loadMessages", () => {
  it("výchozí jazyk: načte jen vyžádané jmenné prostory, bez náhrady", async () => {
    const calls = spyAll();
    const loaded = await loadMessages(defaultLocale, ["common", "auth"]);
    expect(calls.sort()).toEqual([`${defaultLocale}/auth`, `${defaultLocale}/common`]);
    expect(Object.keys(loaded.messages).sort()).toEqual(["auth", "common"]);
    expect(loaded.fallback).toBeUndefined();
  });

  for (const locale of others) {
    it(`${locale}: načte vyžádané jmenné prostory a jako náhradu tytéž ve výchozím jazyce`, async () => {
      const calls = spyAll();
      const loaded = await loadMessages(locale, ["landing"]);
      expect(calls.sort()).toEqual([`${defaultLocale}/landing`, `${locale}/landing`].sort());
      expect(Object.keys(loaded.messages)).toEqual(["landing"]);
      expect(Object.keys(loaded.fallback ?? {})).toEqual(["landing"]);
    });
  }

  it("každý jmenný prostor každého jazyka jde načíst a má zprávy", async () => {
    for (const locale of locales) {
      const loaded = await loadMessages(locale, namespaces);
      for (const namespace of namespaces) {
        expect(
          Object.keys(loaded.messages[namespace] ?? {}).length,
          `${locale}/${namespace}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("neznámý jmenný prostor je srozumitelná chyba", async () => {
    await expect(loadMessages("cs", ["neexistuje" as Namespace])).rejects.toThrow(
      /Neznámý jmenný prostor „neexistuje“/,
    );
  });

  it("opakovaný jmenný prostor se načte jednou", async () => {
    const calls = spyAll();
    await loadMessages(defaultLocale, ["common", "common"]);
    expect(calls).toEqual([`${defaultLocale}/common`]);
  });
});

describe("getTranslator a pickMessages", () => {
  for (const locale of others) {
    it(`${locale}: chybějící překlad se vezme z výchozího jazyka a zaloguje`, async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const original = loaders[locale].common;
      vi.spyOn(loaders[locale], "common").mockImplementation(async () => {
        const { default: messages } = await original();
        const copy: Record<string, unknown> = { ...messages };
        delete copy.brand;
        return { default: copy as typeof messages };
      });
      const reference = await getTranslator(defaultLocale, ["common"]);
      const t = await getTranslator(locale, ["common"]);
      expect(t("common.brand")).toBe(reference("common.brand"));
      expect(error).toHaveBeenCalledWith(expect.stringContaining("common.brand"));

      const flat = await pickMessages(locale, ["common"]);
      expect(flat["common.brand"]).toBe(reference("common.brand"));
    });
  }

  it("pickMessages vrací jen klíče vyžádaných jmenných prostorů", async () => {
    const flat = await pickMessages("cs", ["wizard"]);
    const keys = Object.keys(flat);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key.startsWith("wizard."))).toBe(true);
  });
});
