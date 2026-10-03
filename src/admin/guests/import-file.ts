import "server-only";
import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import { readSheet } from "read-excel-file/node";
import { decodeCsv, IMPORT_LIMITS, parseCsv } from "./import-parse";

/**
 * Načtení nahraného souboru se seznamem hostů do tabulky řetězců (FR-ADM-4). Soubor je cizí vstup:
 * velikost se omezuje dřív, než se na něj sáhne, formát se pozná podle obsahu (ne podle přípony),
 * u XLSX se rozbalený obsah počítá skutečně (proudové rozbalení s přerušením na stropu, velikosti z hlaviček archivu se nevěří; zip bomba), omezen je i počet položek a rozměry listu
 * a knihovna `read-excel-file` pracuje jen se vzorcem a hodnotami buněk, nic nespouští.
 * Starý binární `.xls` se odmítá (jiný formát, uživatel ho uloží jako `.xlsx` nebo CSV).
 */

export type FileFailure = "too_large" | "unsupported_format" | "unreadable" | "unpacked_too_large";

export type ReadResult = { ok: true; table: string[][] } | { ok: false; reason: FileFailure };

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((value, index) => bytes[index] === value);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value === "boolean") return value ? "ano" : "ne";
  return String(value);
}

/** Nejvíc položek v archivu XLSX (skutečný soubor jich má kolem dvaceti). */
const MAX_ZIP_ENTRIES = 64;
/** Vstup se do rozbalovače posílá po částech: jedna část se nafoukne nejvýše asi tisíckrát (deflate). */
const PUSH_CHUNK = 16 * 1024;
/** Nejvíc řádků a sloupců listu, které se vůbec převádějí na text (hranice nad IMPORT_LIMITS.rows). */
const MAX_SHEET_ROWS = 5000;
const MAX_SHEET_COLUMNS = 100;

/**
 * Zip bomba: velikosti uvedené v archivu (adresář, hlavičky) jsou řeč útočníka, proto se NEPOUŽÍVAJÍ.
 * Archiv se rozbaluje proudově po malých částech a počítají se skutečně rozbalené bajty; po překročení
 * stropu (celkem nebo u jedné položky) se rozbalování okamžitě přeruší. Omezen je i počet položek.
 * `true` = archiv je příliš velký; poškozený archiv vyhodí výjimku.
 */
function unpackedTooLarge(bytes: Uint8Array): boolean {
  let total = 0;
  let entries = 0;
  let exceeded = false;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = (file) => {
    if (exceeded) return;
    entries += 1;
    if (entries > MAX_ZIP_ENTRIES) {
      exceeded = true;
      return;
    }
    file.ondata = (error, chunk) => {
      if (error) throw error;
      total += chunk.length;
      if (total > IMPORT_LIMITS.unpackedBytes) {
        exceeded = true;
        file.terminate();
      }
    };
    file.start();
  };
  try {
    for (let offset = 0; offset < bytes.length && !exceeded; offset += PUSH_CHUNK) {
      const end = Math.min(offset + PUSH_CHUNK, bytes.length);
      unzip.push(bytes.subarray(offset, end), end === bytes.length);
    }
  } catch (error) {
    if (exceeded) return true;
    throw error;
  }
  if (exceeded) return true;
  if (entries === 0) throw new Error("empty_archive");
  return false;
}

export async function readTable(bytes: Uint8Array): Promise<ReadResult> {
  if (bytes.byteLength === 0) return { ok: false, reason: "unreadable" };
  if (bytes.byteLength > IMPORT_LIMITS.fileBytes) return { ok: false, reason: "too_large" };

  if (startsWith(bytes, OLE_MAGIC)) return { ok: false, reason: "unsupported_format" };

  if (startsWith(bytes, ZIP_MAGIC)) {
    try {
      if (unpackedTooLarge(bytes)) return { ok: false, reason: "unpacked_too_large" };
      const sheet = await readSheet(Buffer.from(bytes));
      // rozměry listu se hlídají dřív, než se buňky převádějí na text
      if (sheet.length > MAX_SHEET_ROWS || sheet.some((row) => row.length > MAX_SHEET_COLUMNS)) {
        return { ok: false, reason: "too_large" };
      }
      return { ok: true, table: sheet.map((row) => row.map(cellText)) };
    } catch {
      return { ok: false, reason: "unreadable" };
    }
  }

  // text: CSV; bajt 0 prozrazuje binární soubor jiného druhu
  if (bytes.includes(0)) return { ok: false, reason: "unsupported_format" };
  try {
    return { ok: true, table: parseCsv(decodeCsv(bytes)) };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
