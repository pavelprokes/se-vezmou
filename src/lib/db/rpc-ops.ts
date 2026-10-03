import "server-only";
import type { Locale } from "@/i18n/config";
import { z } from "zod";
import { call, firstRow, type Bytes } from "./rpc";
import { WEDDING_STATUSES, type OperatorRole, type WeddingStatus } from "./types";

/**
 * Typované obaly funkcí provozní administrace (M9, docs/adr/0012): relace a druhý faktor operátorů
 * (`auth_operator_*`) a operátorské čtení a zásahy (`op_*`). Volá se jako service role po ověření relace
 * operátora na serveru; každá `op_*` funkce si roli ověří sama a zásah zapíše do auditu v téže transakci.
 * Žádná z nich nevrací jména ani údaje hostů, kromě `opViewGuestData` (jen se souhlasem páru).
 */

// --- relace a druhý faktor -----------------------------------------------------------------

export type OperatorFound = { operatorId: string; role: OperatorRole; totpConfirmed: boolean };

export async function authOperatorFind(email: string): Promise<OperatorFound | null> {
  const row = await firstRow<{ operator_id: string; role: OperatorRole; totp_confirmed: boolean }>(
    "auth_operator_find",
    { p_email: email },
  );
  return row
    ? { operatorId: row.operator_id, role: row.role, totpConfirmed: row.totp_confirmed }
    : null;
}

export function authOperatorCreateSession(input: {
  operatorId: string;
  tokenHash: Bytes;
  idleSeconds: number;
  absoluteSeconds: number;
}): Promise<string> {
  return call<string>(
    "auth_operator_create_session",
    {
      p_operator_id: input.operatorId,
      p_token_hash: input.tokenHash,
      p_idle_seconds: input.idleSeconds,
      p_absolute_seconds: input.absoluteSeconds,
    },
    "scalar",
  );
}

export type ValidOperatorSession = {
  sessionId: string;
  operatorId: string;
  email: string;
  role: OperatorRole;
  /** Druhý faktor ověřen (úroveň AAL2). Bez něj se nesmí otevřít nic kromě stránek druhého faktoru. */
  aal2: boolean;
  totpConfirmed: boolean;
};

export async function authOperatorValidateSession(
  tokenHash: Bytes,
): Promise<ValidOperatorSession | null> {
  const row = await firstRow<{
    session_id: string;
    operator_id: string;
    email: string;
    role: OperatorRole;
    aal2: boolean;
    totp_confirmed: boolean;
  }>("auth_operator_validate_session", { p_token_hash: tokenHash });
  return row
    ? {
        sessionId: row.session_id,
        operatorId: row.operator_id,
        email: row.email,
        role: row.role,
        aal2: row.aal2,
        totpConfirmed: row.totp_confirmed,
      }
    : null;
}

export function authOperatorRevokeSession(tokenHash: Bytes): Promise<boolean> {
  return call<boolean>("auth_operator_revoke_session", { p_token_hash: tokenHash }, "scalar");
}

export type OperatorMfaState = {
  secretEnc: string | null;
  confirmed: boolean;
  lastStep: number | null;
};

export async function authOperatorMfaGet(operatorId: string): Promise<OperatorMfaState | null> {
  const row = await firstRow<{
    secret_enc: string | null;
    confirmed: boolean;
    last_step: string | number | null;
  }>("auth_operator_mfa_get", { p_operator_id: operatorId });
  return row
    ? {
        secretEnc: row.secret_enc,
        confirmed: row.confirmed,
        lastStep: row.last_step === null ? null : Number(row.last_step),
      }
    : null;
}

/** Uloží šifrovaný klíč, jen když zatím žádný není; vrací uložený (opakované otevření ukáže tentýž). */
export function authOperatorMfaBegin(operatorId: string, secretEnc: string): Promise<string> {
  return call<string>(
    "auth_operator_mfa_begin",
    { p_operator_id: operatorId, p_secret_enc: secretEnc },
    "scalar",
  );
}

export function authOperatorMfaConfirm(input: {
  operatorId: string;
  sessionId: string;
  step: number;
  backupHashes: Bytes[];
}): Promise<boolean> {
  return call<boolean>(
    "auth_operator_mfa_confirm",
    {
      p_operator_id: input.operatorId,
      p_session_id: input.sessionId,
      p_step: input.step,
      p_backup_hashes: input.backupHashes,
    },
    "scalar",
  );
}

export function authOperatorMfaAccept(input: {
  operatorId: string;
  sessionId: string;
  step: number;
}): Promise<boolean> {
  return call<boolean>(
    "auth_operator_mfa_accept",
    { p_operator_id: input.operatorId, p_session_id: input.sessionId, p_step: input.step },
    "scalar",
  );
}

/** Počet zbývajících záložních kódů, nebo -1 pro neplatný či už použitý kód. */
export function authOperatorUseBackupCode(input: {
  operatorId: string;
  sessionId: string;
  codeHash: Bytes;
}): Promise<number> {
  return call<number>(
    "auth_operator_use_backup_code",
    {
      p_operator_id: input.operatorId,
      p_session_id: input.sessionId,
      p_code_hash: input.codeHash,
    },
    "scalar",
  );
}

export function authOperatorBackupCodesLeft(operatorId: string): Promise<number> {
  return call<number>("auth_operator_backup_codes_left", { p_operator_id: operatorId }, "scalar");
}

export function authOperatorRegenerateBackupCodes(
  operatorId: string,
  hashes: Bytes[],
): Promise<number> {
  return call<number>(
    "auth_operator_regenerate_backup_codes",
    { p_operator_id: operatorId, p_backup_hashes: hashes },
    "scalar",
  );
}

// --- čtení ---------------------------------------------------------------------------------

/** Sloupec typu `date` vrací `pg` jako `Date` o místní půlnoci; složky data se čtou místně. */
function dateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export type WeddingListFilters = {
  status?: WeddingStatus;
  locale?: Locale;
  template?: string;
  /** První den měsíce svatby (`2027-06-01`). */
  month?: string;
  query?: string;
  limit: number;
  offset: number;
};

export type WeddingListRow = {
  id: string;
  slug: string | null;
  status: WeddingStatus;
  partnerAName: string;
  partnerBName: string;
  template: string;
  defaultLocale: string;
  locales: string[];
  startsOn: string | null;
  publishedAt: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
  adminCount: number;
};

export async function opListWeddings(
  operatorId: string,
  filters: WeddingListFilters,
): Promise<{ rows: WeddingListRow[]; total: number }> {
  const rows = await call<
    {
      id: string;
      slug: string | null;
      status: WeddingStatus;
      partner_a_name: string;
      partner_b_name: string;
      template: string;
      default_locale: string;
      locales: string[];
      starts_on: Date | string | null;
      published_at: Date | null;
      last_activity_at: Date;
      created_at: Date;
      admin_count: number;
      total_count: string | number;
    }[]
  >(
    "op_list_weddings",
    {
      p_operator_id: operatorId,
      p_status: filters.status,
      p_locale: filters.locale,
      p_template: filters.template,
      p_month: filters.month,
      p_query: filters.query,
      p_limit: filters.limit,
      p_offset: filters.offset,
    },
    "table",
  );
  return {
    rows: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      status: r.status,
      partnerAName: r.partner_a_name,
      partnerBName: r.partner_b_name,
      template: r.template,
      defaultLocale: r.default_locale,
      locales: r.locales,
      startsOn: dateOnly(r.starts_on),
      publishedAt: r.published_at,
      lastActivityAt: r.last_activity_at,
      createdAt: r.created_at,
      adminCount: r.admin_count,
    })),
    total: rows[0] ? Number(rows[0].total_count) : 0,
  };
}

const nullableIso = z.string().nullable();

const detailSchema = z.object({
  wedding: z.object({
    id: z.string(),
    slug: z.string().nullable(),
    status: z.enum(WEDDING_STATUSES),
    template: z.string(),
    palette: z.string(),
    default_locale: z.string(),
    locales: z.array(z.string()),
    partner_a_name: z.string(),
    partner_b_name: z.string(),
    starts_on: nullableIso,
    ends_on: nullableIso,
    timezone: z.string(),
    published_at: nullableIso,
    blocked_at: nullableIso,
    deleted_at: nullableIso,
    purge_at: nullableIso,
    health_purge_at: nullableIso,
    guest_purge_at: nullableIso,
    created_at: z.string(),
    last_activity_at: z.string(),
    published_version_no: z.number().nullable(),
    phase_override: z.string().nullable(),
    has_preview: z.boolean(),
    /** Smazaný web v ochranné lhůtě, který jde obnovit. */
    restorable: z.boolean(),
  }),
  order: z
    .object({
      plan_code: z.string(),
      status: z.string(),
      service_ends_at: nullableIso,
    })
    .nullable(),
  slug_state: z
    .object({
      state: z.string(),
      reserved_until: nullableIso,
      first_published_at: nullableIso,
    })
    .nullable(),
  admins: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      added_at: z.string(),
      removed_at: nullableIso,
      last_login_at: nullableIso,
    }),
  ),
  history: z.array(
    z.object({
      from_status: z.string().nullable(),
      to_status: z.string(),
      actor_type: z.string(),
      reason: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  notes: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      created_at: z.string(),
      operator_email: z.string(),
    }),
  ),
  counts: z.object({ guests: z.number(), households: z.number(), responses: z.number() }),
  guest_access: z.object({ expires_at: z.string() }).nullable(),
});

export type WeddingDetail = z.infer<typeof detailSchema>;

export async function opGetWedding(
  operatorId: string,
  weddingId: string,
): Promise<WeddingDetail | null> {
  const value = await call<unknown>(
    "op_get_wedding",
    { p_operator_id: operatorId, p_wedding_id: weddingId },
    "scalar",
  );
  return value === null ? null : detailSchema.parse(value);
}

const overviewSchema = z.object({
  by_status: z.record(z.string(), z.number()),
  by_month: z.array(z.object({ month: z.string(), count: z.number() })),
  without_date: z.number(),
  by_template: z.record(z.string(), z.number()),
  by_locale: z.record(z.string(), z.number()),
});

export type OpsOverview = z.infer<typeof overviewSchema>;

export async function opOverview(operatorId: string): Promise<OpsOverview> {
  return overviewSchema.parse(
    await call<unknown>("op_overview", { p_operator_id: operatorId }, "scalar"),
  );
}

export type AnalyticsRow = {
  event: string;
  locale: string | null;
  template: string | null;
  step: number | null;
  events: number;
};

export async function opAnalyticsSummary(
  operatorId: string,
  days: number,
): Promise<AnalyticsRow[]> {
  const rows = await call<
    {
      event: string;
      locale: string | null;
      template: string | null;
      step: number | null;
      events: string | number;
    }[]
  >("op_analytics_summary", { p_operator_id: operatorId, p_days: days }, "table");
  return rows.map((r) => ({ ...r, events: Number(r.events) }));
}

export type AuditFilters = {
  action?: string;
  weddingId?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
};

export type AuditRow = {
  id: number;
  at: Date;
  actorType: string;
  actorId: string | null;
  actorEmail: string | null;
  weddingId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  meta: Record<string, unknown>;
};

export async function opListAudit(
  operatorId: string,
  filters: AuditFilters,
): Promise<{ rows: AuditRow[]; total: number }> {
  const rows = await call<
    {
      id: string | number;
      at: Date;
      actor_type: string;
      actor_id: string | null;
      actor_email: string | null;
      wedding_id: string | null;
      action: string;
      target_type: string | null;
      target_id: string | null;
      reason: string | null;
      meta: Record<string, unknown>;
      total_count: string | number;
    }[]
  >(
    "op_list_audit",
    {
      p_operator_id: operatorId,
      p_action: filters.action,
      p_wedding_id: filters.weddingId,
      p_actor_id: filters.actorId,
      p_from: filters.from,
      p_to: filters.to,
      p_limit: filters.limit,
      p_offset: filters.offset,
    },
    "table",
  );
  return {
    rows: rows.map((r) => ({
      id: Number(r.id),
      at: r.at,
      actorType: r.actor_type,
      actorId: r.actor_id,
      actorEmail: r.actor_email,
      weddingId: r.wedding_id,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      meta: r.meta,
    })),
    total: rows[0] ? Number(rows[0].total_count) : 0,
  };
}

// --- zásahy --------------------------------------------------------------------------------

export async function opSetWeddingStatus(input: {
  operatorId: string;
  weddingId: string;
  status: WeddingStatus;
  reason: string;
}): Promise<void> {
  await call(
    "op_set_wedding_status",
    {
      p_operator_id: input.operatorId,
      p_wedding_id: input.weddingId,
      p_status: input.status,
      p_reason: input.reason,
    },
    "scalar",
  );
}

export function opAddNote(input: {
  operatorId: string;
  weddingId: string;
  body: string;
}): Promise<string> {
  return call<string>(
    "op_add_note",
    { p_operator_id: input.operatorId, p_wedding_id: input.weddingId, p_body: input.body },
    "scalar",
  );
}

export async function opChangeSlug(input: {
  operatorId: string;
  weddingId: string;
  slug: string;
  reason: string;
}): Promise<void> {
  await call(
    "op_change_slug",
    {
      p_operator_id: input.operatorId,
      p_wedding_id: input.weddingId,
      p_slug: input.slug,
      p_reason: input.reason,
    },
    "scalar",
  );
}

export type RetentionExtendKind = "service" | "health" | "guests";

export async function opExtendRetention(input: {
  operatorId: string;
  weddingId: string;
  kind: RetentionExtendKind;
  /** Datum `YYYY-MM-DD`: platí do konce tohoto dne v pásmu svatby. */
  until: string;
  reason: string;
}): Promise<void> {
  await call(
    "op_extend_retention",
    {
      p_operator_id: input.operatorId,
      p_wedding_id: input.weddingId,
      p_kind: input.kind,
      p_until: input.until,
      p_reason: input.reason,
    },
    "scalar",
  );
}

/** Vrací stav, do kterého se web vrátil. */
export function opRestoreWedding(input: {
  operatorId: string;
  weddingId: string;
  reason: string;
}): Promise<WeddingStatus> {
  return call<WeddingStatus>(
    "op_restore_wedding",
    {
      p_operator_id: input.operatorId,
      p_wedding_id: input.weddingId,
      p_reason: input.reason,
    },
    "scalar",
  );
}

/** Vrací e-mail správce, na který se má kód a odkaz poslat (ověřila ho databáze). */
export function opSendLoginLink(input: {
  operatorId: string;
  weddingId: string;
  adminId: string;
  emailHash: Bytes;
  codeHash: Bytes;
  ttlSeconds: number;
}): Promise<string> {
  return call<string>(
    "op_send_login_link",
    {
      p_operator_id: input.operatorId,
      p_wedding_id: input.weddingId,
      p_admin_id: input.adminId,
      p_email_hash: input.emailHash,
      p_code_hash: input.codeHash,
      p_ttl_seconds: input.ttlSeconds,
    },
    "scalar",
  );
}

export type GuestDataRow = {
  householdLabel: string;
  guestId: string;
  displayName: string;
  isChild: boolean;
  age: number | null;
  isPlusOne: boolean;
  diet: string | null;
  allergies: string | null;
};

/** Údaje hostů jen při aktivním souhlasu páru; bez něj prázdné pole (a odmítnutí v auditu). */
export async function opViewGuestData(input: {
  operatorId: string;
  weddingId: string;
  reason: string;
}): Promise<GuestDataRow[]> {
  const rows = await call<
    {
      household_label: string;
      guest_id: string;
      display_name: string;
      is_child: boolean;
      age: number | null;
      is_plus_one: boolean;
      diet: string | null;
      allergies: string | null;
    }[]
  >(
    "op_view_guest_data",
    { p_operator_id: input.operatorId, p_wedding_id: input.weddingId, p_reason: input.reason },
    "table",
  );
  return rows.map((r) => ({
    householdLabel: r.household_label,
    guestId: r.guest_id,
    displayName: r.display_name,
    isChild: r.is_child,
    age: r.age,
    isPlusOne: r.is_plus_one,
    diet: r.diet,
    allergies: r.allergies,
  }));
}

// --- správa operátorů ----------------------------------------------------------------------

export type OperatorRow = {
  id: string;
  email: string;
  role: OperatorRole;
  disabledAt: Date | null;
  totpConfirmed: boolean;
  backupCodesLeft: number;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export async function opListOperators(operatorId: string): Promise<OperatorRow[]> {
  const rows = await call<
    {
      id: string;
      email: string;
      role: OperatorRole;
      disabled_at: Date | null;
      totp_confirmed: boolean;
      backup_codes_left: number;
      last_login_at: Date | null;
      created_at: Date;
    }[]
  >("op_list_operators", { p_operator_id: operatorId }, "table");
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    disabledAt: r.disabled_at,
    totpConfirmed: r.totp_confirmed,
    backupCodesLeft: r.backup_codes_left,
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
  }));
}

export function opCreateOperator(input: {
  ownerId: string;
  email: string;
  role: OperatorRole;
}): Promise<string> {
  return call<string>(
    "op_create_operator",
    { p_owner_id: input.ownerId, p_email: input.email, p_role: input.role },
    "scalar",
  );
}

export async function opSetOperatorDisabled(input: {
  ownerId: string;
  targetId: string;
  disabled: boolean;
  reason: string;
}): Promise<void> {
  await call(
    "op_set_operator_disabled",
    {
      p_owner_id: input.ownerId,
      p_target_id: input.targetId,
      p_disabled: input.disabled,
      p_reason: input.reason,
    },
    "scalar",
  );
}

export async function opResetOperatorMfa(input: {
  ownerId: string;
  targetId: string;
  reason: string;
}): Promise<void> {
  await call(
    "op_reset_operator_mfa",
    { p_owner_id: input.ownerId, p_target_id: input.targetId, p_reason: input.reason },
    "scalar",
  );
}
