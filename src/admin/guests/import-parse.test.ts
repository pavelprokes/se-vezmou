import { describe, expect, it } from "vitest";
import {
  checkRows,
  decodeCsv,
  interpretTable,
  parseCsv,
  preview,
  toHouseholds,
  totals,
  type ImportRow,
  type ParsedTable,
} from "./import-parse";

function ok(table: string[][]): Extract<ParsedTable, { ok: true }> {
  const parsed = interpretTable(table);
  if (!parsed.ok) throw new Error(`očekáván platný soubor, ale: ${parsed.reason}`);
  return parsed;
}

describe("parseCsv", () => {
  it("pozná středník, čárku i tabulátor podle záhlaví", () => {
    expect(parseCsv("a;b;c\n1;2;3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("zvládne uvozovky, zdvojené uvozovky, oddělovač a nový řádek uvnitř buňky i CRLF", () => {
    const text = 'Jméno;Poznámka\r\n"Novák; Jan";"řekl ""ahoj""\nzítra"\r\n';
    expect(parseCsv(text)).toEqual([
      ["Jméno", "Poznámka"],
      ["Novák; Jan", 'řekl "ahoj"\nzítra'],
    ]);
  });

  it("poslední řádek bez zalomení se nezahodí a prázdný text dá prázdnou tabulku", () => {
    expect(parseCsv("a;b\n1;2")).toHaveLength(2);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("decodeCsv", () => {
  it("odstraní BOM UTF-8", () => {
    const bytes = new TextEncoder().encode("﻿Jméno;Věk");
    expect(decodeCsv(bytes)).toBe("Jméno;Věk");
  });

  it("český Excel bez UTF-8 (Windows-1250) se přečte správně", () => {
    // „Jméno;Řehoř“ ve Windows-1250: é = 0xE9, Ř = 0xD8, ř = 0xF8
    const bytes = new Uint8Array([
      0x4a, 0x6d, 0xe9, 0x6e, 0x6f, 0x3b, 0xd8, 0x65, 0x68, 0x6f, 0xf8,
    ]);
    expect(decodeCsv(bytes)).toBe("Jméno;Řehoř");
  });
});

describe("interpretTable", () => {
  it("rozpozná záhlaví česky i anglicky bez ohledu na diakritiku a pořadí", () => {
    const parsed = ok([
      ["Věk", "JMÉNO A PŘÍJMENÍ", "Rodina", "Dítě"],
      ["", "Jan Novák", "Novákovi", "ne"],
      ["5", "Tomáš Novák", "Novákovi", "ano"],
    ]);
    expect(parsed.rows).toEqual([
      { line: 2, household: "Novákovi", name: "Jan Novák", isChild: false, age: null },
      { line: 3, household: "Novákovi", name: "Tomáš Novák", isChild: true, age: 5 },
    ]);

    const english = ok([
      ["Full name", "Household", "Child", "Age"],
      ["Jan Novak", "The Novaks", "no", ""],
    ]);
    expect(english.rows[0]).toMatchObject({ name: "Jan Novak", household: "The Novaks" });
  });

  it("jméno a příjmení ve dvou sloupcích se spojí", () => {
    const parsed = ok([
      ["Jméno", "Příjmení"],
      ["Eva", "Nováková"],
      ["Petr", ""],
    ]);
    expect(parsed.rows.map((row) => row.name)).toEqual(["Eva Nováková", "Petr"]);
  });

  it("samostatný sloupec Jméno se bere jako celé jméno", () => {
    expect(ok([["Jméno"], ["Eva Nováková"]]).rows[0].name).toBe("Eva Nováková");
  });

  it("věk do 17 bez sloupce Dítě označí hosta za dítě, dospělému se věk ignoruje", () => {
    const parsed = ok([
      ["Jméno", "Věk"],
      ["Anička", "8"],
      ["Karel", "41"],
    ]);
    expect(parsed.rows[0]).toMatchObject({ isChild: true, age: 8 });
    expect(parsed.rows[1]).toMatchObject({ isChild: false, age: null });
    expect(parsed.problems.size).toBe(0);
  });

  it("věk u dítěte nad 17 a nečíselný věk jsou chyba, neznámá hodnota Dítě také", () => {
    const parsed = ok([
      ["Jméno", "Dítě", "Věk"],
      ["A", "ano", "18"],
      ["B", "ano", "osm"],
      ["C", "možná", ""],
      ["D", "ne", ""],
    ]);
    expect(parsed.problems.get(2)).toBe("age_invalid");
    expect(parsed.problems.get(3)).toBe("age_invalid");
    expect(parsed.problems.get(4)).toBe("child_invalid");
    expect(parsed.problems.has(5)).toBe(false);
  });

  it("chybějící a příliš dlouhé jméno a štítek jsou chyby řádku", () => {
    const parsed = ok([
      ["Jméno", "Domácnost"],
      ["", "Novákovi"],
      ["x".repeat(201), ""],
      ["Jan", "y".repeat(201)],
    ]);
    expect(parsed.problems.get(2)).toBe("name_missing");
    expect(parsed.problems.get(3)).toBe("name_too_long");
    expect(parsed.problems.get(4)).toBe("household_too_long");
  });

  it("prázdné řádky se přeskočí, čísla řádků zůstávají podle původní tabulky", () => {
    const parsed = ok([["Jméno"], [""], ["Jan"], ["", ""], ["Eva"]]);
    expect(parsed.rows.map((row) => row.line)).toEqual([3, 5]);
  });

  it("domácnost nad 20 hostů: přebývající řádky se vyřadí", () => {
    const table = [
      ["Jméno", "Domácnost"],
      ...Array.from({ length: 22 }, (_, i) => [`Host ${i}`, "Velká rodina"]),
    ];
    const parsed = ok(table);
    const bad = [...parsed.problems.values()];
    expect(bad).toHaveLength(2);
    expect(new Set(bad)).toEqual(new Set(["household_too_big"]));
  });

  it("soubor bez záhlaví se jménem, prázdný soubor a příliš dlouhý soubor se odmítnou", () => {
    expect(
      interpretTable([
        ["Telefon", "Město"],
        ["1", "2"],
      ]),
    ).toEqual({
      ok: false,
      reason: "no_name_column",
    });
    expect(interpretTable([])).toEqual({ ok: false, reason: "empty" });
    expect(interpretTable([["Jméno"]])).toEqual({ ok: false, reason: "empty" });
    const many = [["Jméno"], ...Array.from({ length: 1001 }, (_, i) => [`H${i}`])];
    expect(interpretTable(many)).toEqual({ ok: false, reason: "too_many_rows" });
  });

  it("buňky se čistí od okolních a opakovaných mezer", () => {
    const parsed = ok([["Jméno"], ["  Jan   Novák  "]]);
    expect(parsed.rows[0].name).toBe("Jan Novák");
  });
});

describe("preview a toHouseholds", () => {
  const table = [
    ["Jméno", "Domácnost", "Dítě"],
    ["Jan Novák", "Novákovi", ""],
    ["Eva Nováková", "novákovi", ""],
    ["Novák Jan", "", ""],
    ["Petr Dvořák", "", ""],
    ["", "", ""],
    ["Marie Nová", "", ""],
  ];

  it("duplicitu pozná i s prohozeným pořadím slov a bez diakritiky, v souboru i v seznamu hostů", () => {
    const rows = preview(ok(table), ["Dvořák Petr", "Karel Černý"]);
    expect(rows.map((row) => row.duplicate)).toEqual([null, null, "file", "existing", null]);
    const jan = rows.find((row) => row.name === "Novák Jan");
    expect(jan?.duplicate).toBe("file");
  });

  it("do zápisu jdou jen řádky bez chyby; duplicity jen na výslovnou volbu; štítek bez ohledu na velikost písmen", () => {
    const rows = preview(ok(table), ["Dvořák Petr"]);
    const without = toHouseholds(rows, false);
    expect(without.map((h) => [h.label, h.guests.map((g) => g.display_name)])).toEqual([
      ["Novákovi", ["Jan Novák", "Eva Nováková"]],
      ["", ["Marie Nová"]],
    ]);
    const withDuplicates = toHouseholds(rows, true);
    expect(withDuplicates.flatMap((h) => h.guests)).toHaveLength(5);
  });

  it("souhrn počítá řádky, chyby, duplicity a domácnosti", () => {
    const rows = preview(ok(table), ["Dvořák Petr"]);
    expect(totals(rows, false)).toEqual({
      rows: 5,
      importable: 3,
      errors: 0,
      duplicates: 2,
      households: 2,
    });
  });

  it("chybné řádky nejsou nikdy mezi duplicitami ani v zápisu", () => {
    const rows = preview(
      ok([
        ["Jméno", "Domácnost"],
        ["", "Rodina"],
        ["Jan", ""],
      ]),
      [],
    );
    expect(rows[0].problem).toBe("name_missing");
    expect(rows[0].duplicate).toBeNull();
    expect(toHouseholds(rows, true)).toHaveLength(1);
  });
});

describe("checkRows (server ověřuje řádky znovu)", () => {
  const row = (over: Partial<ImportRow>): ImportRow => ({
    line: 2,
    household: "",
    name: "Jan",
    isChild: false,
    age: null,
    ...over,
  });

  it("odmítne věk u dospělého a věk nad 17", () => {
    const problems = checkRows([
      row({ line: 2, age: 30 }),
      row({ line: 3, isChild: true, age: 18 }),
      row({ line: 4, isChild: true, age: 9 }),
    ]);
    expect(problems.get(2)).toBe("age_invalid");
    expect(problems.get(3)).toBe("age_invalid");
    expect(problems.has(4)).toBe(false);
  });

  it("počítá velikost domácnosti bez ohledu na velikost písmen a diakritiku", () => {
    const rows = Array.from({ length: 21 }, (_, i) =>
      row({ line: i + 2, name: `Host ${i}`, household: i % 2 ? "Čermákovi" : "ČERMÁKOVI" }),
    );
    expect(checkRows(rows).get(22)).toBe("household_too_big");
  });
});
