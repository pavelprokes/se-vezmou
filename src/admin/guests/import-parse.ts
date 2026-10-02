import { nameKey, normalizeName } from "@/lib/rsvp/names";
import { GUEST_LIMITS } from "./types";

/**
 * Import seznamu hostů z CSV a Excelu (FR-ADM-4): čistá logika bez vstupu a výstupu. Z tabulky
 * textových buněk (první neprázdný řádek je záhlaví) udělá řádky hostů, ověří je a označí
 * duplicity. Soubor se načítá a rozbaluje jinde (`import-file.ts`); tady se s ním už pracuje jen
 * jako s tabulkou řetězců. Nic se nezapisuje: zápis je až po potvrzení náhledu.
 *
 * Záhlaví se rozpoznává bez ohledu na velikost písmen a diakritiku, česky i anglicky:
 * `Domácnost`, `Jméno a příjmení` (nebo `Jméno` a `Příjmení` zvlášť), `Dítě`, `Věk`.
 */

export const IMPORT_LIMITS = {
  /** Největší nahrávaný soubor v bajtech. */
  fileBytes: 1024 * 1024,
  /** Nejvíc řádků dat v jednom importu. */
  rows: 1000,
  /** Největší rozbalený obsah XLSX v bajtech (ochrana před zip bombou). */
  unpackedBytes: 20 * 1024 * 1024,
} as const;

export type ImportRow = {
  /** Číslo řádku v původní tabulce (1 = záhlaví), pro hlášení chyb. */
  line: number;
  household: string;
  name: string;
  isChild: boolean;
  age: number | null;
};

export type RowProblem =
  | "name_missing"
  | "name_too_long"
  | "household_too_long"
  | "age_invalid"
  | "child_invalid"
  | "household_too_big";

export type Duplicate = "file" | "existing";

export type PreviewRow = ImportRow & { problem: RowProblem | null; duplicate: Duplicate | null };

export type TableFailure = "empty" | "no_name_column" | "too_many_rows";

export type ParsedTable =
  | { ok: true; rows: ImportRow[]; problems: Map<number, RowProblem> }
  | { ok: false; reason: TableFailure };

// --- CSV ------------------------------------------------------------------------------------

/** Text CSV z bajtů: UTF-8 (i s BOM), jinak Windows-1250 (český Excel ukládá CSV takto). */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })
      .decode(bytes)
      .replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1250").decode(bytes);
  }
}

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  let quoted = false;
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  for (const char of first) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char] += 1;
  }
  return [";", "\t", ","].reduce((best, c) => (counts[c] > counts[best] ? c : best), ";");
}

/** CSV podle RFC 4180: uvozovky, zdvojené uvozovky, konce řádků LF i CRLF; oddělovač se pozná. */
export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// --- záhlaví a řádky ------------------------------------------------------------------------

const HEADERS = {
  household: ["domacnost", "rodina", "skupina", "household", "family", "group"],
  full: ["jmeno a prijmeni", "cele jmeno", "full name", "name", "host", "hoste", "guest", "guests"],
  first: ["jmeno", "krestni jmeno", "first name", "given name"],
  last: ["prijmeni", "last name", "surname", "family name"],
  child: ["dite", "deti", "dite ano ne", "child", "is child", "kid"],
  age: ["vek", "age"],
} as const;

type Columns = {
  household: number | null;
  full: number | null;
  first: number | null;
  last: number | null;
  child: number | null;
  age: number | null;
};

function findColumns(header: string[]): Columns {
  const keys = header.map((cell) => normalizeName(cell));
  const find = (names: readonly string[]): number | null => {
    const index = keys.findIndex((key) => (names as readonly string[]).includes(key));
    return index === -1 ? null : index;
  };
  return {
    household: find(HEADERS.household),
    full: find(HEADERS.full),
    first: find(HEADERS.first),
    last: find(HEADERS.last),
    child: find(HEADERS.child),
    age: find(HEADERS.age),
  };
}

const TRUE_VALUES = new Set(["ano", "a", "yes", "y", "1", "true", "x", "dite", "child", "kid"]);
const FALSE_VALUES = new Set(["", "ne", "n", "no", "0", "false", "dospely", "adult"]);

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Tabulka textových buněk na řádky hostů (záhlaví = první neprázdný řádek). */
export function interpretTable(table: string[][]): ParsedTable {
  const lines = table
    .map((cells, index) => ({ cells, line: index + 1 }))
    .filter(({ cells }) => cells.some((cell) => clean(cell) !== ""));
  if (lines.length === 0) return { ok: false, reason: "empty" };

  const [head, ...data] = lines;
  const columns = findColumns(head.cells);
  const hasName = columns.full !== null || columns.first !== null;
  if (!hasName) return { ok: false, reason: "no_name_column" };
  if (data.length === 0) return { ok: false, reason: "empty" };
  if (data.length > IMPORT_LIMITS.rows) return { ok: false, reason: "too_many_rows" };

  const rows: ImportRow[] = [];
  const problems = new Map<number, RowProblem>();
  const at = (cells: string[], index: number | null) => (index === null ? "" : clean(cells[index]));

  for (const { cells, line } of data) {
    const name =
      columns.full !== null
        ? at(cells, columns.full)
        : [at(cells, columns.first), at(cells, columns.last)].filter(Boolean).join(" ");
    const household = at(cells, columns.household);
    const childRaw = normalizeName(at(cells, columns.child));
    const ageRaw = at(cells, columns.age);

    let isChild = TRUE_VALUES.has(childRaw);
    let age: number | null = null;
    let problem: RowProblem | null = null;

    if (columns.child !== null && !isChild && !FALSE_VALUES.has(childRaw))
      problem = "child_invalid";
    if (ageRaw !== "") {
      if (!/^\d{1,3}$/.test(ageRaw)) {
        problem ??= "age_invalid";
      } else {
        const value = Number(ageRaw);
        // věk se eviduje jen u dětí; dospělému se ignoruje, bez sloupce „Dítě“ ho věk do 17 označí za dítě
        if (value <= GUEST_LIMITS.maxChildAge && (isChild || columns.child === null)) {
          isChild = true;
          age = value;
        } else if (isChild) {
          problem ??= "age_invalid";
        }
      }
    }
    rows.push({ line, household, name, isChild, age: isChild ? age : null });
    if (problem) problems.set(line, problem);
  }

  return { ok: true, rows, problems: checkRows(rows, problems) };
}

/**
 * Kontroly samotných řádků (jméno, štítek, věk, velikost domácnosti). Stejné kontroly běží znovu
 * při zápisu: server prohlížeči nevěří a řádky z náhledu ověří znovu.
 */
export function checkRows(
  rows: ImportRow[],
  initial: Map<number, RowProblem> = new Map(),
): Map<number, RowProblem> {
  const problems = new Map(initial);
  for (const row of rows) {
    if (problems.has(row.line)) continue;
    let problem: RowProblem | null = null;
    if (row.name === "") problem = "name_missing";
    else if (row.name.length > GUEST_LIMITS.name) problem = "name_too_long";
    else if (row.household.length > GUEST_LIMITS.label) problem = "household_too_long";
    else if (row.age !== null && (!row.isChild || row.age > GUEST_LIMITS.maxChildAge)) {
      problem = "age_invalid";
    }
    if (problem) problems.set(row.line, problem);
  }

  // domácnost nad strop hostů se do databáze nevejde: přebývající řádky se vyřadí
  const sizes = new Map<string, number>();
  for (const row of rows) {
    if (row.household === "" || problems.has(row.line)) continue;
    const key = normalizeName(row.household);
    const size = (sizes.get(key) ?? 0) + 1;
    sizes.set(key, size);
    if (size > GUEST_LIMITS.guestsPerHousehold) problems.set(row.line, "household_too_big");
  }
  return problems;
}

// --- duplicity a seskupení ------------------------------------------------------------------

/**
 * Řádky s chybou a s označenými duplicitami. Duplicita je host se stejným jménem (na pořadí slov
 * a diakritice nezáleží, jako při slepém párování RSVP): buď už v seznamu hostů, nebo dřív v souboru.
 */
export function preview(
  parsed: Extract<ParsedTable, { ok: true }>,
  existingNames: Iterable<string>,
): PreviewRow[] {
  const existing = new Set<string>();
  for (const name of existingNames) existing.add(nameKey(name));
  const seen = new Set<string>();
  return parsed.rows.map((row) => {
    const problem = parsed.problems.get(row.line) ?? null;
    let duplicate: Duplicate | null = null;
    if (!problem) {
      const key = nameKey(row.name);
      if (existing.has(key)) duplicate = "existing";
      else if (seen.has(key)) duplicate = "file";
      seen.add(key);
    }
    return { ...row, problem, duplicate };
  });
}

export type ImportHousehold = {
  label: string;
  guests: { display_name: string; is_child: boolean; age: number | null }[];
};

/**
 * Řádky k zápisu: bez chyb a (podle volby) bez duplicit, seskupené do domácností podle štítku
 * (stejný štítek = jedna domácnost, bez štítku = host sám). Pořadí se zachovává.
 */
export function toHouseholds(rows: PreviewRow[], includeDuplicates: boolean): ImportHousehold[] {
  const households: ImportHousehold[] = [];
  const byKey = new Map<string, ImportHousehold>();
  for (const row of rows) {
    if (row.problem) continue;
    if (row.duplicate && !includeDuplicates) continue;
    const guest = { display_name: row.name, is_child: row.isChild, age: row.age };
    if (row.household === "") {
      households.push({ label: "", guests: [guest] });
      continue;
    }
    const key = normalizeName(row.household);
    const existing = byKey.get(key);
    if (existing) {
      existing.guests.push(guest);
    } else {
      const created: ImportHousehold = { label: row.household, guests: [guest] };
      byKey.set(key, created);
      households.push(created);
    }
  }
  return households;
}

export type PreviewTotals = {
  rows: number;
  importable: number;
  errors: number;
  duplicates: number;
  households: number;
};

export function totals(rows: PreviewRow[], includeDuplicates: boolean): PreviewTotals {
  const households = toHouseholds(rows, includeDuplicates);
  return {
    rows: rows.length,
    importable: households.reduce((sum, h) => sum + h.guests.length, 0),
    errors: rows.filter((row) => row.problem).length,
    duplicates: rows.filter((row) => row.duplicate).length,
    households: households.length,
  };
}
