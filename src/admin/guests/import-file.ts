import "server-only";
import { unzipSync } from "fflate";
import { readSheet } from "read-excel-file/node";
import { decodeCsv, IMPORT_LIMITS, parseCsv } from "./import-parse";

/**
 * Načtení nahraného souboru se seznamem hostů do tabulky řetězců (FR-ADM-4). Soubor je cizí vstup:
 * velikost se omezuje dřív, než se na něj sáhne, formát se pozná podle obsahu (ne podle přípony),
 * u XLSX se před rozbalením zkontroluje velikost rozbaleného obsahu z adresáře archivu (zip bomba)
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

function unpackedTooLarge(bytes: Uint8Array): boolean {
  let total = 0;
  try {
    // filtr jen čte adresář archivu a nic nerozbaluje (vrací false)
    unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        if (
          file.originalSize > IMPORT_LIMITS.unpackedBytes ||
          total > IMPORT_LIMITS.unpackedBytes
        ) {
          throw new RangeError("unpacked_too_large");
        }
        return false;
      },
    });
  } catch (error) {
    if (error instanceof RangeError) return true;
    throw error;
  }
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
