import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nameKey, normalizeName } from "./names";

/**
 * Zlaté vektory sdílené s SQL (`supabase/tests/golden/name-vectors.tsv`, test `90_lifecycle`):
 * vstup, normalizovaný tvar, klíč se seřazenými slovy. Pole se nikdy neořezávají, vstup může
 * začínat i končit mezerou.
 */
const vectors = readFileSync(join(process.cwd(), "supabase/tests/golden/name-vectors.tsv"), "utf8")
  .split("\n")
  .filter((line) => line !== "")
  .map((line) => {
    const [input, normalized, key] = line.split("\t");
    return { input, normalized, key };
  });

describe("normalizace jmen: zlaté vektory shodné s SQL", () => {
  it("soubor má dost vektorů a každý řádek tři pole", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(20);
    for (const v of vectors) {
      expect(typeof v.input).toBe("string");
      expect(typeof v.normalized).toBe("string");
      expect(typeof v.key).toBe("string");
    }
  });

  it.each(vectors.map((v) => [JSON.stringify(v.input), v] as const))(
    "%s",
    (_name, { input, normalized, key }) => {
      expect(normalizeName(input)).toBe(normalized);
      expect(nameKey(input)).toBe(key);
    },
  );
});

describe("normalizace jmen: vlastnosti", () => {
  it("Klára = Klara, velikost písmen a mezery nehrají roli", () => {
    expect(nameKey("Klára")).toBe(nameKey("klara"));
    expect(nameKey("  KLÁRA  Nováková ")).toBe(nameKey("Klara Novakova"));
  });

  it("pořadí jména a příjmení nehraje roli", () => {
    expect(nameKey("Matěj Novák")).toBe(nameKey("Novák Matěj"));
    expect(nameKey("Anna Marie Dvořáková")).toBe(nameKey("Dvořáková, Anna-Marie"));
  });

  it("různá jména zůstávají různá", () => {
    expect(nameKey("Jan Novák")).not.toBe(nameKey("Jana Novák"));
    expect(nameKey("Petr Novák")).not.toBe(nameKey("Pavel Novák"));
  });

  it("je idempotentní", () => {
    for (const { input } of vectors) {
      const once = normalizeName(input);
      expect(normalizeName(once)).toBe(once);
      expect(nameKey(nameKey(input))).toBe(nameKey(input));
    }
  });

  it("prázdný a prázdninový vstup dá prázdný klíč", () => {
    expect(normalizeName("")).toBe("");
    expect(nameKey("   ")).toBe("");
    expect(nameKey("... --- ,,,")).toBe("");
  });

  it("řadí podle bajtů UTF-8, ne podle jazyka (jako collate C v databázi)", () => {
    // Podle jazyka by "ø" stálo mezi "o" a "p"; podle bajtů za všemi ASCII písmeny.
    expect(nameKey("Ørjan Zed")).toBe("zed ørjan");
  });
});
