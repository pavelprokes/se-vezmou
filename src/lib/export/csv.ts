import type { Cell, Table } from "./types";

/**
 * CSV podle RFC 4180 (uvozovky, zdvojené uvozovky, konce řádků CRLF), středník jako oddělovač a BOM UTF-8:
 * české Excely otevírají CSV se středníkem a BOM bez dialogu o importu. Hodnoty z formulářů hostů začínající
 * `=`, `+`, `-`, `@`, tabulátorem nebo CR by Excel i LibreOffice mohly vyhodnotit jako vzorec (CSV injection,
 * OWASP), proto se jim předsadí apostrof: v tabulce je pak vidět původní text a vzorec se nespustí.
 */

export const CSV_DELIMITER = ";";
const BOM = "﻿";
const FORMULA_START = /^[=+\-@\t\r]/;

/** Neutralizace vzorce v textové buňce. Čísla se nepřepisují. */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

export function csvCell(cell: Cell): string {
  if (cell === null) return "";
  const text = typeof cell === "number" ? String(cell) : neutralizeFormula(cell);
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(table: Pick<Table, "headers" | "rows">): Buffer {
  const lines = [table.headers, ...table.rows].map((row) => row.map(csvCell).join(CSV_DELIMITER));
  return Buffer.from(`${BOM}${lines.join("\r\n")}\r\n`, "utf8");
}
