import "server-only";
import { serviceRpc, tenantRpc } from "./rpc";
import type { TenantIdentity } from "./transport";

/**
 * Tenký typovaný obal funkcí správy hostů, RSVP a přístupu (M7b, migrace
 * `20261007100000_admin_guests.sql` a `20261007100100_admin_access.sql`). Všechny funkce správce
 * běží s claimy jedné svatby (role `authenticated`), svatba je vždy z relace, nikdy z argumentu.
 * Odpovědi se ověřují schématy v `src/admin/guests` a `src/admin/access`.
 */

export type AdminIdentity = { weddingId: string; subjectId: string };

function identity(session: AdminIdentity): TenantIdentity {
  return { weddingId: session.weddingId, weddingRole: "admin", subject: session.subjectId };
}

// --- hosté ----------------------------------------------------------------------------------

export function adminHouseholdSave(
  session: AdminIdentity,
  householdId: string | null,
  payload: unknown,
): Promise<string> {
  return tenantRpc<string>(identity(session), "admin_household_save", {
    p_household_id: householdId,
    p_payload: payload,
  });
}

export async function adminHouseholdDelete(
  session: AdminIdentity,
  householdId: string,
): Promise<void> {
  await tenantRpc(identity(session), "admin_household_delete", { p_household_id: householdId });
}

export function adminGuestsImport(
  session: AdminIdentity,
  payload: unknown,
): Promise<{ households: number; guests: number; skipped: number; duplicate: boolean }> {
  return tenantRpc(identity(session), "admin_guests_import", { p_payload: payload });
}

export function adminInvitationsBulk(
  session: AdminIdentity,
  eventId: string,
  invited: boolean,
): Promise<number> {
  return tenantRpc<number>(identity(session), "admin_invitations_bulk", {
    p_event_id: eventId,
    p_invited: invited,
  });
}

/** Hromadné pozvání hostů skupiny (štítku); `tag` null = všichni hosté. */
export function adminInvitationsBulkTag(
  session: AdminIdentity,
  eventId: string,
  invited: boolean,
  tag: string | null,
): Promise<number> {
  return tenantRpc<number>(identity(session), "admin_invitations_bulk_tag", {
    p_event_id: eventId,
    p_invited: invited,
    p_tag: tag,
  });
}

/** Nový kód osobního odkazu domácnosti (starý přestane platit). */
export function adminHouseholdInviteReset(
  session: AdminIdentity,
  householdId: string,
): Promise<string> {
  return tenantRpc<string>(identity(session), "admin_household_invite_reset", {
    p_household_id: householdId,
  });
}

// --- nastavení RSVP -------------------------------------------------------------------------

export function adminRsvpSettingsGet(session: AdminIdentity): Promise<unknown> {
  return tenantRpc<unknown>(identity(session), "admin_rsvp_settings_get");
}

/** Vrací identifikátory otázek po uložení: `[{ key, id }]`. */
export function adminRsvpSettingsSave(session: AdminIdentity, payload: unknown): Promise<unknown> {
  return tenantRpc<unknown>(identity(session), "admin_rsvp_settings_save", { p_payload: payload });
}

/** Příznak upozornění páru na odpovědi hostů (vlastní funkce, nepatří do uložení otázek). */
export function adminRsvpNotifyGet(session: AdminIdentity): Promise<boolean> {
  return tenantRpc<boolean>(identity(session), "admin_rsvp_notify_get");
}

export async function adminRsvpNotifySet(session: AdminIdentity, enabled: boolean): Promise<void> {
  await tenantRpc(identity(session), "admin_rsvp_notify_set", { p_enabled: enabled });
}

// --- přístup --------------------------------------------------------------------------------

export function adminAccessLoad(session: AdminIdentity): Promise<unknown> {
  return tenantRpc<unknown>(identity(session), "admin_access_load");
}

export function adminAdminAdd(session: AdminIdentity, email: string): Promise<unknown> {
  return tenantRpc<unknown>(identity(session), "admin_admin_add", { p_email: email });
}

export function adminAdminRemove(session: AdminIdentity, adminId: string): Promise<unknown> {
  return tenantRpc<unknown>(identity(session), "admin_admin_remove", { p_admin_id: adminId });
}

export function adminBackupEmailSet(session: AdminIdentity, email: string): Promise<unknown> {
  return tenantRpc<unknown>(identity(session), "admin_backup_email_set", { p_email: email });
}

export async function adminGuestPinEnabledSet(
  session: AdminIdentity,
  enabled: boolean,
): Promise<void> {
  await tenantRpc(identity(session), "admin_guest_pin_enabled_set", { p_enabled: enabled });
}

/** Zámek celého webu PINem hostů. */
export function adminSiteLockGet(session: AdminIdentity): Promise<boolean> {
  return tenantRpc<boolean>(identity(session), "admin_site_lock_get");
}

export async function adminSiteLockSet(session: AdminIdentity, locked: boolean): Promise<void> {
  await tenantRpc(identity(session), "admin_site_lock_set", { p_locked: locked });
}

export function grantOperatorAccess(
  session: AdminIdentity,
  reason: string,
  days: number,
): Promise<unknown> {
  return tenantRpc<unknown>(identity(session), "grant_operator_access", {
    p_reason: reason,
    p_days: days,
  });
}

export function revokeOperatorAccess(session: AdminIdentity, grantId: string): Promise<unknown> {
  return tenantRpc<unknown>(identity(session), "revoke_operator_access", {
    p_grant_id: grantId,
  });
}

export function adminWeddingDelete(session: AdminIdentity): Promise<unknown> {
  return tenantRpc<unknown>(identity(session), "admin_wedding_delete");
}

// --- oznámení o nahlédnutí provozovatele (service role) -------------------------------------

/** Adresy správců a záložní adresa svatby pro oznámení; jen pro odeslání, nikam se neukládají. */
export async function guestDataNoticeRecipients(
  weddingId: string,
): Promise<{ email: string; locale: string }[]> {
  return serviceRpc<{ email: string; locale: string }[]>(
    "guest_data_notice_recipients",
    { p_wedding_id: weddingId },
    "table",
  );
}

/** Adresy správců pro upozornění na odpověď; prázdné, když má svatba upozornění vypnuté. */
export async function rsvpNotifyRecipients(
  weddingId: string,
): Promise<{ email: string; locale: string }[]> {
  return serviceRpc<{ email: string; locale: string }[]>(
    "rsvp_notify_recipients",
    { p_wedding_id: weddingId },
    "table",
  );
}
