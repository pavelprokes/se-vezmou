import "server-only";
import { limited, reasonOf } from "@/lib/rate-guard";
import { currentHostConfig, siteHostname } from "@/auth/app-origin";
import { RATE_RULES } from "@/auth/config";
import { normalizeEmail } from "@/auth/identity";
import type { Defer } from "@/auth/login";
import { normalizePinInput, type PinProblem } from "@/auth/pin";
import { setPin } from "@/auth/pin-login";
import { requireEnv } from "@/env";
import { type Locale, toLocale } from "@/i18n/config";
import {
  adminAccessLoad,
  adminAdminAdd,
  adminAdminRemove,
  adminBackupEmailSet,
  adminGuestPinEnabledSet,
  adminWeddingDelete,
  grantOperatorAccess,
  guestDataNoticeRecipients,
  revokeOperatorAccess,
  type AdminIdentity,
  adminSiteLockGet,
  adminSiteLockSet,
} from "@/lib/db/admin-guests";
import { authSessionContext } from "@/lib/db/rpc";
import { sendTemplatedEmail } from "@/lib/email/send";
import { renderAdminNotice, type AdminNoticeKind } from "@/lib/email/templates";
import { z } from "zod";
import {
  GRANT_DAYS,
  GRANT_REASON,
  accessViewSchema,
  addAdminResultSchema,
  backupResultSchema,
  deleteResultSchema,
  grantResultSchema,
  notifyResultSchema,
  removeAdminResultSchema,
  type AccessView,
} from "./types";

/**
 * Serverová logika přístupu ke správě webu (M7b): správci, záložní e-mail, PIN, souhlas s nahlédnutím
 * provozovatele, smazání webu. Svatba je vždy z relace. Změny, které se týkají toho, kdo smí k údajům,
 * posílají oznámení ostatním správcům a na záložní adresu (nejlepší úsilí po odpovědi, `defer`):
 * oznámení nikdy neblokuje samotnou změnu. Adresy z databáze slouží jen k odeslání, do logu ani do
 * auditu se nedostanou.
 */

export type AccessActor = AdminIdentity & { sessionId: string };

/** Společný kontext akce: jazyk rozhraní, adresa pro odkazy a odložené odeslání e-mailů. */
export type AccessContext = {
  locale: Locale;
  /** Adresa přihlašovací stránky pro odkazy v e-mailech. */
  loginUrl: string;
  defer: Defer;
};

export type Limited = { status: "limited"; retryAfter: number };

export async function loadAccess(session: AdminIdentity): Promise<AccessView> {
  const [view, siteLocked] = await Promise.all([
    adminAccessLoad(session),
    adminSiteLockGet(session),
  ]);
  return { ...accessViewSchema.parse(view), site_locked: siteLocked };
}

// --- oznámení -------------------------------------------------------------------------------

type NoticeTarget = { email: string; kind: AdminNoticeKind };

/** Pošle oznámení (každá adresa nejvýš jednou, první uvedený druh vyhrává) po odpovědi, nejlepším úsilím. */
function sendNotices(
  ctx: AccessContext,
  view: Pick<AccessView, "slug" | "default_locale" | "timezone">,
  weddingId: string,
  targets: NoticeTarget[],
  extra: { until?: Date; reason?: string; loginUrl?: boolean } = {},
): void {
  const secret = requireEnv("AUTH_SECRET");
  const site = view.slug ? siteHostname(view.slug, currentHostConfig()) : undefined;
  const seen = new Set<string>();
  for (const target of targets) {
    const key = target.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const email = renderAdminNotice({
      locale: view.default_locale,
      kind: target.kind,
      at: new Date(),
      site,
      loginUrl: extra.loginUrl === false ? undefined : ctx.loginUrl,
      until: extra.until,
      timeZone: view.timezone,
      reason: extra.reason,
    });
    ctx.defer(() =>
      sendTemplatedEmail({
        type: "admin_changed",
        to: target.email,
        weddingId,
        locale: view.default_locale,
        email,
        secret,
      }),
    );
  }
}

// --- správci --------------------------------------------------------------------------------

export type AddAdminResult =
  { status: "added" } | { status: "invalid" } | { status: "exists" } | { status: "full" } | Limited;

export async function addAdmin(
  actor: AccessActor,
  ctx: AccessContext,
  rawEmail: unknown,
): Promise<AddAdminResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { status: "invalid" };
  const retry = await limited("access-change", actor.weddingId, RATE_RULES.accessChangeWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    const result = addAdminResultSchema.parse(await adminAdminAdd(actor, email));
    const view = await loadAccess(actor);
    sendNotices(ctx, view, actor.weddingId, [
      { email, kind: "admin_added" },
      ...result.notify.map((to): NoticeTarget => ({ email: to, kind: "admin_added_others" })),
    ]);
    return { status: "added" };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "invalid_email") return { status: "invalid" };
    if (reason === "admin_exists") return { status: "exists" };
    if (reason === "max_admins_exceeded") return { status: "full" };
    throw error;
  }
}

export type RemoveAdminResult =
  { status: "removed" } | { status: "self" } | { status: "not_found" } | Limited;

export async function removeAdmin(
  actor: AccessActor,
  ctx: AccessContext,
  adminId: unknown,
): Promise<RemoveAdminResult> {
  const id = z.uuid().safeParse(adminId);
  if (!id.success) return { status: "not_found" };
  const retry = await limited("access-change", actor.weddingId, RATE_RULES.accessChangeWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    const result = removeAdminResultSchema.parse(await adminAdminRemove(actor, id.data));
    const view = await loadAccess(actor);
    sendNotices(
      ctx,
      view,
      actor.weddingId,
      [
        { email: result.removed, kind: "admin_removed" },
        ...result.notify.map((to): NoticeTarget => ({ email: to, kind: "admin_removed_others" })),
      ],
      { loginUrl: true },
    );
    return { status: "removed" };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "cannot_remove_self") return { status: "self" };
    if (reason === "admin_not_found") return { status: "not_found" };
    throw error;
  }
}

// --- záložní e-mail -------------------------------------------------------------------------

export type BackupResult =
  { status: "changed" } | { status: "same" } | { status: "invalid" } | Limited;

export async function setBackupEmail(
  actor: AccessActor,
  ctx: AccessContext,
  rawEmail: unknown,
): Promise<BackupResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { status: "invalid" };
  const retry = await limited("access-change", actor.weddingId, RATE_RULES.accessChangeWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    const result = backupResultSchema.parse(await adminBackupEmailSet(actor, email));
    if (!result.changed) return { status: "same" };
    const view = await loadAccess(actor);
    sendNotices(ctx, view, actor.weddingId, [
      ...(result.old ? [{ email: result.old, kind: "backup_changed_old" } as NoticeTarget] : []),
      // Nová adresa je nepotvrzená: dostane jedinou neutrální zprávu, žádná další oznámení nechodí.
      { email, kind: "backup_added" },
      ...result.notify.map((to): NoticeTarget => ({ email: to, kind: "backup_changed" })),
    ]);
    return { status: "changed" };
  } catch (error) {
    if (reasonOf(error) === "invalid_email") return { status: "invalid" };
    throw error;
  }
}

// --- PIN ------------------------------------------------------------------------------------

export type PinResult =
  { status: "ok" } | { status: "invalid"; problem: PinProblem | "same_as_other" } | Limited;

/** Nastavení nebo změna PINu správy, nebo hostů; oznámení na záložní e-mail odesílá `setPin`. */
export async function changePin(
  actor: AccessActor,
  ctx: AccessContext,
  role: "admin" | "guest",
  rawPin: unknown,
): Promise<PinResult> {
  const retry = await limited("access-change", actor.weddingId, RATE_RULES.accessChangeWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  const pin = normalizePinInput(typeof rawPin === "string" ? rawPin : "");
  const context = await authSessionContext(actor.weddingId);
  const result = await setPin({
    weddingId: actor.weddingId,
    slug: context?.slug ?? null,
    role,
    pin,
    actorAdminId: actor.subjectId,
    keepSessionId: actor.sessionId,
    locale: ctx.locale,
    origin: new URL(ctx.loginUrl).origin,
    defer: ctx.defer,
  });
  return result.status === "ok" ? { status: "ok" } : { status: "invalid", problem: result.problem };
}

export type GuestPinToggleResult = { status: "ok" } | { status: "pin_missing" } | Limited;

export async function setGuestPinEnabled(
  actor: AccessActor,
  enabled: unknown,
): Promise<GuestPinToggleResult> {
  if (typeof enabled !== "boolean") return { status: "pin_missing" };
  const retry = await limited("access-change", actor.weddingId, RATE_RULES.accessChangeWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    await adminGuestPinEnabledSet(actor, enabled);
    return { status: "ok" };
  } catch (error) {
    if (reasonOf(error) === "pin_missing") return { status: "pin_missing" };
    throw error;
  }
}

export type SiteLockResult = GuestPinToggleResult;

/** Celý web jen po PINu hostů (nebo osobním odkazu); zamknout jde jen se zapnutým PINem hostů. */
export async function setSiteLocked(actor: AccessActor, locked: unknown): Promise<SiteLockResult> {
  if (typeof locked !== "boolean") return { status: "pin_missing" };
  const retry = await limited("access-change", actor.weddingId, RATE_RULES.accessChangeWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    await adminSiteLockSet(actor, locked);
    return { status: "ok" };
  } catch (error) {
    if (reasonOf(error) === "pin_missing") return { status: "pin_missing" };
    throw error;
  }
}

// --- souhlas s nahlédnutím provozovatele ----------------------------------------------------

const grantSchema = z.object({
  reason: z.string().trim().min(GRANT_REASON.min).max(GRANT_REASON.max),
  days: z
    .number()
    .int()
    .refine((d) => (GRANT_DAYS as readonly number[]).includes(d)),
});

export type GrantResult = { status: "granted" } | { status: "invalid" } | Limited;

export async function grantAccess(
  actor: AccessActor,
  ctx: AccessContext,
  input: unknown,
): Promise<GrantResult> {
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const retry = await limited("access-change", actor.weddingId, RATE_RULES.accessChangeWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    const result = grantResultSchema.parse(
      await grantOperatorAccess(actor, parsed.data.reason, parsed.data.days),
    );
    const view = await loadAccess(actor);
    sendNotices(
      ctx,
      view,
      actor.weddingId,
      result.notify.map((email): NoticeTarget => ({ email, kind: "operator_access_granted" })),
      { until: new Date(result.expires_at) },
    );
    return { status: "granted" };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "reason_required" || reason === "invalid_period") return { status: "invalid" };
    throw error;
  }
}

export type RevokeResult = { status: "revoked" } | { status: "not_found" } | Limited;

export async function revokeAccess(
  actor: AccessActor,
  ctx: AccessContext,
  grantId: unknown,
): Promise<RevokeResult> {
  const id = z.uuid().safeParse(grantId);
  if (!id.success) return { status: "not_found" };
  const retry = await limited("access-change", actor.weddingId, RATE_RULES.accessChangeWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    const result = notifyResultSchema.parse(await revokeOperatorAccess(actor, id.data));
    const view = await loadAccess(actor);
    sendNotices(
      ctx,
      view,
      actor.weddingId,
      result.notify.map((email): NoticeTarget => ({ email, kind: "operator_access_revoked" })),
    );
    return { status: "revoked" };
  } catch (error) {
    if (reasonOf(error) === "grant_not_found") return { status: "not_found" };
    throw error;
  }
}

/**
 * Oznámení správcům o skutečném nahlédnutí provozovatele do údajů hostů (OQ-53). Volá provozní
 * administrace po úspěšném `op_view_guest_data` (service role): adresy čte funkce
 * `guest_data_notice_recipients`. Selhání oznámení nesmí nahlédnutí zablokovat ani prozradit
 * adresy; chyba se loguje jen názvem.
 */
export async function notifyGuestDataViewed(input: {
  weddingId: string;
  reason: string;
  defer: Defer;
}): Promise<void> {
  try {
    const [recipients, context] = await Promise.all([
      guestDataNoticeRecipients(input.weddingId),
      authSessionContext(input.weddingId),
    ]);
    const config = currentHostConfig();
    const site = context?.slug ? siteHostname(context.slug, config) : undefined;
    const loginUrl = `https://app.${config.rootDomains[0]}/prihlaseni`;
    const secret = requireEnv("AUTH_SECRET");
    const seen = new Set<string>();
    for (const row of recipients) {
      const key = row.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const locale: Locale = toLocale(row.locale);
      const email = renderAdminNotice({
        locale,
        kind: "guest_data_viewed",
        at: new Date(),
        site,
        loginUrl,
        reason: input.reason,
      });
      input.defer(() =>
        sendTemplatedEmail({
          type: "admin_changed",
          to: row.email,
          weddingId: input.weddingId,
          locale,
          email,
          secret,
        }),
      );
    }
  } catch (error) {
    console.error(
      "[správa] oznámení o nahlédnutí selhalo",
      error instanceof Error ? error.name : "Error",
    );
  }
}

// --- smazání webu ---------------------------------------------------------------------------

/** Potvrzovací slovo (jazyk rozhraní nerozhoduje: platí obě, velikost písmen nehraje roli). */
export const DELETE_WORDS = ["smazat", "delete"] as const;

export type DeleteSiteResult =
  { status: "deleted" } | { status: "confirm_required" } | { status: "not_found" } | Limited;

export async function deleteSite(
  actor: AccessActor,
  ctx: AccessContext,
  confirmation: unknown,
): Promise<DeleteSiteResult> {
  const word = typeof confirmation === "string" ? confirmation.trim().toLowerCase() : "";
  if (!(DELETE_WORDS as readonly string[]).includes(word)) return { status: "confirm_required" };
  const retry = await limited("access-change", actor.weddingId, RATE_RULES.accessChangeWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  const view = await loadAccess(actor);
  try {
    const result = deleteResultSchema.parse(await adminWeddingDelete(actor));
    sendNotices(
      ctx,
      view,
      actor.weddingId,
      result.notify.map((email): NoticeTarget => ({ email, kind: "site_deleted" })),
      { until: result.purge_at ? new Date(result.purge_at) : undefined, loginUrl: false },
    );
    return { status: "deleted" };
  } catch (error) {
    if (reasonOf(error) === "wedding_not_found") return { status: "not_found" };
    throw error;
  }
}
