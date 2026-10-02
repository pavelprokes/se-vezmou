import { getUiLocale } from "@/auth/request";
import { getSession } from "@/auth/session";
import { toCsv } from "@/lib/export/csv";
import { toXlsx } from "@/lib/export/xlsx";
import type { Table } from "@/lib/export/types";

/**
 * Vzorová tabulka pro import hostů (CSV nebo Excel) se záhlavím a třemi ukázkovými řádky ve
 * správném tvaru. Jen pro přihlášeného správce (stejně jako zbytek správy); neobsahuje žádné údaje.
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await getSession())) return new Response(null, { status: 401 });
  const locale = await getUiLocale();
  const csv = new URL(request.url).searchParams.get("format") === "csv";

  const table: Table =
    locale === "cs"
      ? {
          name: "Hosté",
          headers: ["Domácnost", "Jméno a příjmení", "Dítě", "Věk"],
          rows: [
            ["Novákovi", "Jan Novák", "ne", null],
            ["Novákovi", "Eva Nováková", "ne", null],
            ["Novákovi", "Tomáš Novák", "ano", 5],
            [null, "Petra Svobodová", "ne", null],
          ],
        }
      : {
          name: "Guests",
          headers: ["Household", "Full name", "Child", "Age"],
          rows: [
            ["The Novaks", "Jan Novak", "no", null],
            ["The Novaks", "Eva Novakova", "no", null],
            ["The Novaks", "Tomas Novak", "yes", 5],
            [null, "Petra Svobodova", "no", null],
          ],
        };
  const body = csv ? toCsv(table) : await toXlsx(table);
  const base = locale === "cs" ? "vzor-hoste" : "guest-list-template";
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": csv
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.${csv ? "csv" : "xlsx"}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
