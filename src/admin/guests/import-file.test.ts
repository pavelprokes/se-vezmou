import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/export/csv";
import { toXlsx } from "@/lib/export/xlsx";
import { readTable } from "./import-file";
import { IMPORT_LIMITS, interpretTable } from "./import-parse";

const table = {
  name: "Hosté",
  headers: ["Domácnost", "Jméno a příjmení", "Dítě", "Věk"],
  rows: [
    ["Novákovi", "Jan Novák", "ne", null],
    ["Novákovi", "Tomáš Novák", "ano", 5],
  ],
};

describe("readTable", () => {
  it("přečte Excel (.xlsx), který sami vyrábíme jako vzor, včetně čísel a diakritiky", async () => {
    const result = await readTable(new Uint8Array(await toXlsx(table)));
    expect(result).toEqual({
      ok: true,
      table: [
        ["Domácnost", "Jméno a příjmení", "Dítě", "Věk"],
        ["Novákovi", "Jan Novák", "ne", ""],
        ["Novákovi", "Tomáš Novák", "ano", "5"],
      ],
    });
  });

  it("vzorový soubor jde celý projít importem bez chyby (Excel i CSV)", async () => {
    for (const bytes of [new Uint8Array(await toXlsx(table)), new Uint8Array(toCsv(table))]) {
      const read = await readTable(bytes);
      if (!read.ok) throw new Error(read.reason);
      const parsed = interpretTable(read.table);
      if (!parsed.ok) throw new Error(parsed.reason);
      expect(parsed.problems.size).toBe(0);
      expect(parsed.rows.map((row) => [row.name, row.isChild, row.age])).toEqual([
        ["Jan Novák", false, null],
        ["Tomáš Novák", true, 5],
      ]);
    }
  });

  it("přečte CSV se středníkem a BOM (formát našeho exportu)", async () => {
    const result = await readTable(new Uint8Array(toCsv(table)));
    expect(result.ok && result.table[1]).toEqual(["Novákovi", "Jan Novák", "ne", ""]);
  });

  it("příliš velký soubor se odmítne dřív, než se čte", async () => {
    expect(await readTable(new Uint8Array(IMPORT_LIMITS.fileBytes + 1))).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("prázdný soubor, starý .xls a binární obsah se odmítnou s důvodem", async () => {
    expect(await readTable(new Uint8Array(0))).toEqual({ ok: false, reason: "unreadable" });
    expect(
      await readTable(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toEqual({ ok: false, reason: "unsupported_format" });
    expect(await readTable(new Uint8Array([0x4a, 0x00, 0x01, 0x02]))).toEqual({
      ok: false,
      reason: "unsupported_format",
    });
  });

  it("poškozený archiv se odmítne a nevyhodí výjimku", async () => {
    expect(await readTable(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]))).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("zip bomba (malý archiv, obrovský rozbalený obsah) se odmítne před rozbalením", async () => {
    const bomb = zipSync(
      { "xl/worksheets/sheet1.xml": new Uint8Array(IMPORT_LIMITS.unpackedBytes + 1024) },
      { level: 9 },
    );
    expect(bomb.byteLength).toBeLessThan(IMPORT_LIMITS.fileBytes);
    expect(await readTable(bomb)).toEqual({ ok: false, reason: "unpacked_too_large" });
  });

  it("hodnota začínající vzorcem zůstane obyčejný text (nic se nevyhodnocuje)", async () => {
    const result = await readTable(
      new Uint8Array(
        await toXlsx({
          name: "Hosté",
          headers: ["Jméno"],
          rows: [['=HYPERLINK("http://example.test";"x")']],
        }),
      ),
    );
    expect(result.ok && result.table[1][0]).toBe('=HYPERLINK("http://example.test";"x")');
  });
});
