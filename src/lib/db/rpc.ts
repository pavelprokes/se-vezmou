import "server-only";
import { getTransport, type RpcKind, type RpcTransport, type TenantIdentity } from "./transport";
import type { SessionKind } from "./types";

/**
 * Tenký typovaný obal volání funkcí databáze před ověřením a po něm na serveru
 * (`security definer`, role service_role). Jedna funkce SQL = jedna metoda; názvy argumentů
 * odpovídají `supabase/migrations`. Nic z toho nesmí volat prohlížeč.
 *
 * Doprava je vyměnitelná kvůli testům (`setTransport`).
 */

let override: RpcTransport | undefined;

/** Jen pro testy: nahradí dopravu (null vrací výchozí). */
export function setTransport(transport: RpcTransport | null): void {
  override = transport ?? undefined;
}

export function call<T>(
  fn: string,
  args: Record<string, unknown>,
  kind: RpcKind,
  as?: TenantIdentity,
): Promise<T> {
  return (override ?? getTransport()).call(fn, args, kind, as) as Promise<T>;
}

/** Volání libovolné funkce jako service role (pro tenké moduly mimo tento soubor, např. analytiku). */
export function serviceRpc<T>(
  fn: string,
  args: Record<string, unknown> = {},
  kind: RpcKind = "scalar",
): Promise<T> {
  return call<T>(fn, args, kind);
}

/**
 * Funkce, které čtou claimy transakce (visitor, guest_pin, admin): volají se s totožností jedné svatby
 * (role `authenticated`), ne jako service role. Typované obaly jsou v `src/lib/rsvp`.
 */
export function tenantRpc<T>(
  as: TenantIdentity,
  fn: string,
  args: Record<string, unknown> = {},
  kind: RpcKind = "scalar",
): Promise<T> {
  return call<T>(fn, args, kind, as);
}

export async function firstRow<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const rows = await call<T[]>(fn, args, "table");
  return rows[0] ?? null;
}

/** Hash tokenu je bytea; do funkcí se předává jako Buffer. */
export type Bytes = Buffer;

// --- omezení počtu požadavků -------------------------------------------------------------

export type RateLimit = { allowed: boolean; retryAfter: number };

export async function rateLimitHit(
  bucketKey: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimit> {
  const row = await firstRow<{ allowed: boolean; retry_after: number }>("rate_limit_hit", {
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window: `${windowSeconds} seconds`,
  });
  if (!row) throw new Error("rate_limit_hit nevrátila řádek");
  return { allowed: row.allowed, retryAfter: row.retry_after };
}

export type LockoutState = { locked: boolean; retryAfter: number };

export async function lockoutState(bucketKey: string): Promise<LockoutState> {
  const row = await firstRow<{ locked: boolean; retry_after: number }>("auth_lockout_state", {
    p_bucket_key: bucketKey,
  });
  return { locked: row?.locked ?? false, retryAfter: row?.retry_after ?? 0 };
}

export type LockoutFailure = LockoutState & { level: number; newlyLocked: boolean };

export async function lockoutFailure(
  bucketKey: string,
  options: { threshold: number; baseSeconds: number; maxSeconds: number },
): Promise<LockoutFailure> {
  const row = await firstRow<{
    locked: boolean;
    retry_after: number;
    level: number;
    newly_locked: boolean;
  }>("auth_lockout_failure", {
    p_bucket_key: bucketKey,
    p_threshold: options.threshold,
    p_base_seconds: options.baseSeconds,
    p_max_seconds: options.maxSeconds,
  });
  if (!row) throw new Error("auth_lockout_failure nevrátila řádek");
  return {
    locked: row.locked,
    retryAfter: row.retry_after,
    level: row.level,
    newlyLocked: row.newly_locked,
  };
}

export async function lockoutReset(bucketKey: string): Promise<void> {
  await call("auth_lockout_reset", { p_bucket_key: bucketKey }, "scalar");
}

// --- adresy ------------------------------------------------------------------------------

export type ResolvedSlug = {
  weddingId: string;
  status: string;
  defaultLocale: string;
  locales: string[];
  template: string;
};

export async function resolveSlug(slug: string): Promise<ResolvedSlug | null> {
  const row = await firstRow<{
    wedding_id: string;
    status: string;
    default_locale: string;
    locales: string[];
    template: string;
  }>("resolve_slug", { p_slug: slug });
  return row
    ? {
        weddingId: row.wedding_id,
        status: row.status,
        defaultLocale: row.default_locale,
        locales: row.locales,
        template: row.template,
      }
    : null;
}

// --- relace ------------------------------------------------------------------------------

export async function authCreateSession(input: {
  kind: SessionKind;
  weddingId: string;
  subjectId: string | null;
  tokenHash: Bytes;
  idleSeconds: number;
  absoluteSeconds: number;
}): Promise<string> {
  return call<string>(
    "auth_create_session",
    {
      p_kind: input.kind,
      p_wedding_id: input.weddingId,
      p_subject_id: input.subjectId,
      p_token_hash: input.tokenHash,
      p_idle_seconds: input.idleSeconds,
      p_absolute_seconds: input.absoluteSeconds,
    },
    "scalar",
  );
}

export type ValidSession = {
  sessionId: string;
  weddingId: string;
  kind: SessionKind;
  subjectId: string | null;
};

export async function authValidateSession(tokenHash: Bytes): Promise<ValidSession | null> {
  const row = await firstRow<{
    session_id: string;
    wedding_id: string;
    kind: SessionKind;
    subject_id: string | null;
  }>("auth_validate_session", { p_token_hash: tokenHash });
  return row
    ? {
        sessionId: row.session_id,
        weddingId: row.wedding_id,
        kind: row.kind,
        subjectId: row.subject_id,
      }
    : null;
}

export function authRevokeSession(tokenHash: Bytes): Promise<boolean> {
  return call<boolean>("auth_revoke_session", { p_token_hash: tokenHash }, "scalar");
}

export function authRevokeSessions(weddingId: string, subjectId?: string): Promise<number> {
  return call<number>(
    "auth_revoke_sessions",
    { p_wedding_id: weddingId, p_subject_id: subjectId },
    "scalar",
  );
}

// --- výzvy (kód z e-mailu) ---------------------------------------------------------------

export type ChallengePurpose =
  "admin_login" | "admin_add_confirm" | "operator_recovery" | "wizard_create" | "operator_login";

export function authCreateChallenge(input: {
  emailHash: Bytes;
  purpose: ChallengePurpose;
  codeHash: Bytes;
  ttlSeconds: number;
}): Promise<string> {
  return call<string>(
    "auth_create_challenge",
    {
      p_email_hash: input.emailHash,
      p_purpose: input.purpose,
      p_code_hash: input.codeHash,
      p_ttl_seconds: input.ttlSeconds,
    },
    "scalar",
  );
}

export function authVerifyChallenge(input: {
  emailHash: Bytes;
  purpose: ChallengePurpose;
  codeHash: Bytes;
  maxAttempts?: number;
}): Promise<boolean> {
  return call<boolean>(
    "auth_verify_challenge",
    {
      p_email_hash: input.emailHash,
      p_purpose: input.purpose,
      p_code_hash: input.codeHash,
      p_max_attempts: input.maxAttempts,
    },
    "scalar",
  );
}

export type AdminWedding = {
  adminId: string;
  weddingId: string;
  slug: string | null;
  status: string;
};

export async function authListAdminWeddings(email: string): Promise<AdminWedding[]> {
  const rows = await call<
    { admin_id: string; wedding_id: string; slug: string | null; status: string }[]
  >("auth_list_admin_weddings", { p_email: email }, "table");
  return rows.map((row) => ({
    adminId: row.admin_id,
    weddingId: row.wedding_id,
    slug: row.slug,
    status: row.status,
  }));
}

// --- PIN ---------------------------------------------------------------------------------

export type PinRole = "admin" | "guest";

export type PinRecord = {
  weddingId: string;
  adminId: string | null;
  pinHash: string;
  backupEmail: string;
};

export async function authPinGet(slug: string, role: PinRole): Promise<PinRecord | null> {
  const row = await firstRow<{
    wedding_id: string;
    admin_id: string | null;
    pin_hash: string;
    backup_email: string;
  }>("auth_pin_get", { p_slug: slug, p_role: role });
  return row
    ? {
        weddingId: row.wedding_id,
        adminId: row.admin_id,
        pinHash: row.pin_hash,
        backupEmail: row.backup_email,
      }
    : null;
}

export function authPinOtherHash(weddingId: string, role: PinRole): Promise<string | null> {
  return call<string | null>(
    "auth_pin_other_hash",
    { p_wedding_id: weddingId, p_role: role },
    "scalar",
  );
}

/** Vrací záložní e-mail, na který se má poslat oznámení o změně. */
export function authPinSet(input: {
  weddingId: string;
  role: PinRole;
  hash: string;
  actorAdminId?: string | null;
  keepSessionId?: string | null;
}): Promise<string> {
  return call<string>(
    "auth_pin_set",
    {
      p_wedding_id: input.weddingId,
      p_role: input.role,
      p_hash: input.hash,
      p_actor_admin_id: input.actorAdminId ?? undefined,
      p_keep_session_id: input.keepSessionId ?? undefined,
    },
    "scalar",
  );
}

export type SessionContext = {
  slug: string | null;
  status: string;
  partnerAName: string;
  partnerBName: string;
};

export async function authSessionContext(weddingId: string): Promise<SessionContext | null> {
  const row = await firstRow<{
    slug: string | null;
    status: string;
    partner_a_name: string;
    partner_b_name: string;
  }>("auth_session_context", { p_wedding_id: weddingId });
  return row
    ? {
        slug: row.slug,
        status: row.status,
        partnerAName: row.partner_a_name,
        partnerBName: row.partner_b_name,
      }
    : null;
}

// --- záznam e-mailů (bez osobních údajů) -------------------------------------------------

export type EmailLogType =
  | "login_code"
  | "rsvp_confirmation"
  | "admin_changed"
  | "backup_login_notice"
  | "expiry_notice"
  | "deletion_notice"
  | "operator_notice";

export type EmailLogStatus = "queued" | "sent" | "delivered" | "bounced" | "complained" | "failed";

export function emailLogInsert(input: {
  type: EmailLogType;
  weddingId: string | null;
  locale: "cs" | "en";
  recipientHash: Bytes;
  recipientDomain: string;
}): Promise<string> {
  return call<string>(
    "email_log_insert",
    {
      p_type: input.type,
      p_wedding_id: input.weddingId,
      p_locale: input.locale,
      p_recipient_hash: input.recipientHash,
      p_recipient_domain: input.recipientDomain,
    },
    "scalar",
  );
}

export function emailLogSetStatus(
  id: string,
  status: EmailLogStatus,
  details: { providerMessageId?: string; errorCode?: string } = {},
): Promise<boolean> {
  return call<boolean>(
    "email_log_set_status",
    {
      p_id: id,
      p_status: status,
      p_provider_message_id: details.providerMessageId,
      p_error_code: details.errorCode,
    },
    "scalar",
  );
}
