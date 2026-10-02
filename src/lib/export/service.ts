import "server-only";
import type { AdminSession } from "@/auth/session";
import type { Locale } from "@/i18n/config";
import { tenantRpc } from "@/lib/db/rpc";
import type { TenantIdentity } from "@/lib/db/transport";
import { toCsv } from "./csv";
import { buildGuestTable } from "./table";
import { guestExportSchema, type ExportFile, type ExportFormat } from "./types";
import { toXlsx } from "./xlsx";

/**
 * Export hostů a RSVP (FR-LC-2) jako CSV nebo Excel. Volá se JEN s ověřenou relací správce
 * (`requireSession()` v Server Action nebo route handleru): žádný veřejný odkaz na export. Databázová funkce
 * `admin_export_guests` navíc sama vyžaduje claimy role admin, filtruje podle svatby a zapisuje audit
 * `export.guests` bez osobních údajů. Zdravotní údaje (dieta, alergie) jsou jen na výslovnou žádost
 * (`includeHealth`) a jejich vydání se eviduje (`rsvp_health.exported_at`).
 *
 * Sdílená knihovna: správa webu páru (M7b) ji volá z administrace, upozornění před smazáním na ni odkazuje.
 */

export type ExportOptions = {
  format: ExportFormat;
  /** Jazyk popisků sloupců (jazyk rozhraní správce). */
  locale: Locale;
  includeHealth?: boolean;
  /** Pro název souboru; výchozí je dnešek. */
  now?: Date;
};

type AdminIdentity = Pick<AdminSession, "weddingId" | "subjectId">;

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function exportGuestsAndRsvp(
  session: AdminIdentity,
  options: ExportOptions,
): Promise<ExportFile> {
  const identity: TenantIdentity = {
    weddingId: session.weddingId,
    weddingRole: "admin",
    subject: session.subjectId,
  };
  const raw = await tenantRpc<unknown>(identity, "admin_export_guests", {
    p_include_health: options.includeHealth ?? false,
  });
  const table = buildGuestTable(guestExportSchema.parse(raw), options.locale);

  const day = (options.now ?? new Date()).toISOString().slice(0, 10);
  const base = options.locale === "cs" ? "hoste-a-rsvp" : "guests-and-rsvp";
  return {
    filename: `${base}-${day}.${options.format}`,
    contentType: CONTENT_TYPES[options.format],
    body: options.format === "csv" ? toCsv(table) : await toXlsx(table),
  };
}
