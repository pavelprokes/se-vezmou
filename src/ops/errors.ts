import { DbError } from "@/lib/db/transport";

/**
 * Chyba databáze -> klíč chyby formuláře (`ops.error.<klíč>`). Funkce `op_*` hlásí chyby krátkými
 * identifikátory (`reason_required`, `slug_unavailable`), které `DbError` zachová; vše ostatní je `generic`.
 * Text chyby se nikdy nezobrazí ani nezaloguje se vstupem (mohl by nést osobní údaje).
 */
export type OpsErrorKey =
  | "forbidden"
  | "reason"
  | "notFound"
  | "slugUnavailable"
  | "invalidSlug"
  | "notExtension"
  | "datePast"
  | "notRestorable"
  | "cannotPublish"
  | "useRestore"
  | "invalidNote"
  | "invalidStatus"
  | "invalidKind"
  | "invalidPhase"
  | "weddingBlocked"
  | "duplicate"
  | "invalidEmail"
  | "invalidRole"
  | "selfNotAllowed"
  | "generic";

const BY_REASON: Record<string, OpsErrorKey> = {
  operator_forbidden: "forbidden",
  reason_required: "reason",
  wedding_not_found: "notFound",
  admin_not_found: "notFound",
  operator_not_found: "notFound",
  slug_unavailable: "slugUnavailable",
  invalid_slug: "invalidSlug",
  not_an_extension: "notExtension",
  date_in_past: "datePast",
  not_restorable: "notRestorable",
  cannot_publish: "cannotPublish",
  use_restore: "useRestore",
  invalid_note: "invalidNote",
  invalid_status: "invalidStatus",
  invalid_kind: "invalidKind",
  invalid_phase: "invalidPhase",
  wedding_blocked: "weddingBlocked",
  invalid_email: "invalidEmail",
  invalid_role: "invalidRole",
  self_not_allowed: "selfNotAllowed",
  wedding_deleted: "notRestorable",
};

export function opsErrorKey(error: unknown): OpsErrorKey {
  if (!(error instanceof DbError)) return "generic";
  if (error.reason && error.reason in BY_REASON) return BY_REASON[error.reason];
  if (error.code === "42501") return "forbidden";
  if (error.code === "P0002") return "notFound";
  if (error.code === "23505") return "duplicate";
  return "generic";
}

/** Pole formuláře, ke kterému chyba patří (pro zaměření a `aria-describedby`). */
export function opsErrorField(key: OpsErrorKey): string | undefined {
  switch (key) {
    case "reason":
      return "reason";
    case "invalidPhase":
      return "phase";
    case "slugUnavailable":
    case "invalidSlug":
      return "slug";
    case "notExtension":
    case "datePast":
      return "until";
    case "invalidNote":
      return "body";
    case "duplicate":
    case "invalidEmail":
      return "email";
    default:
      return undefined;
  }
}
