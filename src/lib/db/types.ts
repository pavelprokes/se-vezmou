// Typy databázové vrstvy (M3). Zrcadlí kontrolní omezení v supabase/migrations a claimy transakce
// z docs/data-model.md (kap. 5.1) a docs/adr/0011-dedicated-schema-direct-pg.md. Tady jsou jen společné
// pojmy, které aplikace potřebuje při práci s claimy a s funkcemi databáze.

/** Aplikační role nesená claimem `wedding_role`. */
export const WEDDING_ROLES = ["admin", "guest_pin", "visitor", "preview"] as const;
export type WeddingRole = (typeof WEDDING_ROLES)[number];

/** Databázová role, na kterou transakce správce a hosta přepne `set local role` (ADR 0011). */
export const TENANT_DB_ROLE = "authenticated" as const;

/** U návštěvníka a náhledu je `sub` konstantní (není to žádná osoba ani relace). */
export const ANONYMOUS_SUB = "00000000-0000-0000-0000-000000000000";

/**
 * Claimy, které server nastaví v transakci (`set_config('request.jwt.claims', <json>, true)`) po ověření
 * vlastní relace. Čtou je pomocné funkce `se_vezmou.wedding_id()`, `se_vezmou.wedding_role()` a
 * `se_vezmou.actor_id()` (docs/data-model.md kap. 5.2, docs/adr/0011). Žádný podpis ani platnost:
 * claimy nikdy neopouštějí transakci na serveru.
 */
export type TenantClaims = {
  /** `wedding_admins.id` u `admin`, `sessions.id` u `guest_pin`, jinak ANONYMOUS_SUB. */
  sub: string;
  /** Svatba, pro kterou politiky RLS vpouštějí řádky (`se_vezmou.wedding_id()`). */
  wedding_id: string;
  /** Aplikační role (`se_vezmou.wedding_role()`). */
  wedding_role: WeddingRole;
};

export const WEDDING_STATUSES = [
  "draft",
  "pending_payment",
  "published",
  "archived",
  "deleted",
  "blocked",
] as const;
export type WeddingStatus = (typeof WEDDING_STATUSES)[number];

/** Odvozená fáze zveřejněného webu (`se_vezmou.phase`, docs/data-model.md kap. 7). */
export const WEDDING_PHASES = [
  "save_the_date",
  "rsvp_open",
  "rsvp_closed",
  "wedding_day",
  "thanks",
] as const;
export type WeddingPhase = (typeof WEDDING_PHASES)[number];

export type SessionKind = "admin" | "guest_pin";
export type OperatorRole = "owner" | "support";
export type SlugState = "reserved_word" | "reserved" | "active" | "retired";

/** Odpověď funkce `rate_limit_hit`. */
export type RateLimitResult = { allowed: boolean; retry_after: number };

/** Důvody odpovědi `check_slug` (zabraná, rezervovaná i zakázaná adresa mají stejný důvod). */
export type CheckSlugReason = "ok" | "invalid" | "unavailable" | "rate_limited";
export type CheckSlugResult = {
  available: boolean | null;
  reason: CheckSlugReason;
  retry_after: number;
};

/** Odpověď funkce `reserve_slug`: při kolizi `ok = false` a nabídka volných variant. */
export type ReserveSlugResult = { ok: boolean; variants: string[] };
