import writeXlsxFile from "write-excel-file/node";
import type { Table } from "./types";

/**
 * Excel (.xlsx) knihovnou `write-excel-file`: vybrána proto, že je malá (jedna závislost, `fflate`), jen zapisuje
 * (nečte cizí soubory, tedy není útočná plocha při importu) a nemá nativní kód. Texty zapisuje jako textové
 * buňky, nikdy jako vzorce, takže hodnota z formuláře hosta (`=HYPERLINK(...)`) se nespustí. Srovnání:
 * `exceljs` je zhruba dvacetkrát větší a táhne desítky závislostí; psaní XLSX ručně přes ZIP by opakovalo
 * cizí práci (styly, sdílené řetězce, kompatibilita Excelu).
 */
export async function toXlsx(table: Pick<Table, "name" | "headers" | "rows">): Promise<Buffer> {
  const header = table.headers.map((value) => ({ value, fontWeight: "bold" as const }));
  const rows = table.rows.map((row) => row.map((cell) => (cell === null ? null : cell)));
  const widths = table.headers.map((title, index) => {
    const longest = Math.max(
      title.length,
      ...table.rows.map((row) => String(row[index] ?? "").length),
    );
    return { width: Math.min(Math.max(longest + 2, 10), 50) };
  });
  return await writeXlsxFile([header, ...rows], {
    sheet: table.name.slice(0, 31),
    columns: widths,
    stickyRowsCount: 1,
  }).toBuffer();
}
