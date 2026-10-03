import type { OperatorRole } from "@/lib/db/types";

/**
 * Matice oprávnění rolí operátorů (docs/adr/0012, supabase/migrations/20261006120100_operators_ops.sql).
 * Rozhoduje databáze (každá `op_*` funkce si roli ověří sama); tato matice slouží rozhraní, aby nenabízelo
 * zásahy, které by databáze odmítla, a aby serverová akce odmítla dřív, než sáhne do databáze.
 */

export const OPERATOR_ACTIONS = [
  /** Seznam, detail, přehled, analytika, retence. */
  "view",
  "note",
  "login_link",
  /** Nahlédnutí do údajů hostů (jen s aktivním souhlasem páru). */
  "guest_data",
  /** Ruční přepsání fáze webu (M10). */
  "phase",
  /** Změna stavu na „zablokováno“. */
  "block",
  /** Ostatní změny stavu (odblokování, archivace, smazání, zveřejnění). */
  "set_status",
  "change_slug",
  "extend_retention",
  "restore",
  "audit",
  "manage_operators",
  /** Úpravy článků blogu (jen soubory v repozitáři, do databáze nesahá). */
  "blog",
] as const;

export type OperatorAction = (typeof OPERATOR_ACTIONS)[number];

const SUPPORT: ReadonlySet<OperatorAction> = new Set([
  "view",
  "note",
  "login_link",
  "guest_data",
  "phase",
  "block",
]);

export function can(role: OperatorRole, action: OperatorAction): boolean {
  return role === "owner" ? true : SUPPORT.has(action);
}
