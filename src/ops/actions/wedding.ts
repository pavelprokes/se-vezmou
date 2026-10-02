"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireEnv } from "@/env";
import { currentHostConfig } from "@/auth/app-origin";
import { getHost } from "@/auth/request";
import { parseSlug } from "@/auth/identity";
import { rateKey } from "@/auth/rate-limit";
import type { Defer } from "@/auth/login";
import { rateLimitHit } from "@/lib/db/rpc";
import {
  opAddNote,
  opChangeSlug,
  opExtendRetention,
  opGetWedding,
  opRestoreWedding,
  opSetWeddingStatus,
  opViewGuestData,
  type GuestDataRow,
} from "@/lib/db/rpc-ops";
import { WEDDING_STATUSES } from "@/lib/db/types";
import { OPERATOR_RATE_RULES } from "../config";
import { opsErrorField, opsErrorKey } from "../errors";
import { isIsoDay } from "../format";
import { sendAdminLoginLink } from "../login-link";
import { appOriginForAdminHost } from "../urls";
import { can, type OperatorAction } from "../roles";
import { authorizeOperator, type OperatorSession } from "../session";
import type { ActionState } from "../ui/action-form";

/**
 * Server Actions zásahů do zakázky. Každá: shodný původ, platná relace AAL2, oprávnění role, zod na
 * vstupu, volání `op_*` (ověří roli znovu a zapíše audit v téže transakci). Žádný vstup (důvod,
 * poznámka, jména) se nezapisuje do záznamů serveru. Chyby se mapují na krátké klíče, ne na text databáze.
 */

const defer: Defer = (task) =>
  after(async () => {
    await task();
  });

const reasonSchema = z.string().trim().min(1).max(500);
const idSchema = z.uuid();

type Guarded =
  | { ok: true; session: OperatorSession; weddingId: string }
  | { ok: false; state: NonNullable<ActionState> };

/** Společný začátek: původ, relace, oprávnění pro zásah a identifikátor zakázky. */
async function guard(action: OperatorAction, formData: FormData): Promise<Guarded> {
  const auth = await authorizeOperator(action);
  if (!auth.ok) {
    return { ok: false, state: { error: auth.reason } };
  }
  const weddingId = idSchema.safeParse(formData.get("weddingId"));
  if (!weddingId.success) return { ok: false, state: { error: "notFound" } };
  return { ok: true, session: auth.session, weddingId: weddingId.data };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failure(error: unknown, values?: Record<string, string>): NonNullable<ActionState> {
  const key = opsErrorKey(error);
  return { error: key, field: opsErrorField(key), values };
}

type Result = "status" | "slug" | "extend" | "restore" | "link" | "note";

/**
 * Po úspěšném zásahu se stránka zakázky načte znovu s hlášením (`?vysledek=`). Hlášení tak nezávisí na
 * formuláři, který zásah odeslal (po zablokování nebo obnově už nemusí existovat), a funguje i bez JavaScriptu.
 */
function done(weddingId: string, result: Result): never {
  revalidatePath(`/h/admin/zakazky/${weddingId}`);
  redirect(`/zakazky/${weddingId}?vysledek=${result}`);
}

export async function changeStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const status = z.enum(WEDDING_STATUSES).safeParse(text(formData, "status"));
  const requested: OperatorAction =
    status.success && status.data === "blocked" ? "block" : "set_status";
  const guarded = await guard(requested, formData);
  if (!guarded.ok) return guarded.state;
  if (!can(guarded.session.role, requested)) return { error: "forbidden" };

  const values = { status: text(formData, "status"), reason: text(formData, "reason") };
  if (!status.success) return { error: "invalidStatus", field: "status", values };
  const reason = reasonSchema.safeParse(values.reason);
  if (!reason.success) return { error: "reason", field: "reason", values };

  try {
    await opSetWeddingStatus({
      operatorId: guarded.session.operatorId,
      weddingId: guarded.weddingId,
      status: status.data,
      reason: reason.data,
    });
  } catch (error) {
    return failure(error, values);
  }
  done(guarded.weddingId, "status");
}

export async function changeSlugAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard("change_slug", formData);
  if (!guarded.ok) return guarded.state;

  const values = { slug: text(formData, "slug"), reason: text(formData, "reason") };
  const slug = parseSlug(values.slug);
  if (!slug) return { error: "invalidSlug", field: "slug", values };
  const reason = reasonSchema.safeParse(values.reason);
  if (!reason.success) return { error: "reason", field: "reason", values };

  try {
    await opChangeSlug({
      operatorId: guarded.session.operatorId,
      weddingId: guarded.weddingId,
      slug,
      reason: reason.data,
    });
  } catch (error) {
    return failure(error, values);
  }
  done(guarded.weddingId, "slug");
}

export async function extendRetentionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard("extend_retention", formData);
  if (!guarded.ok) return guarded.state;

  const values = {
    kind: text(formData, "kind"),
    until: text(formData, "until"),
    reason: text(formData, "reason"),
  };
  const kind = z.enum(["service", "health", "guests"]).safeParse(values.kind);
  if (!kind.success) return { error: "invalidKind", field: "kind", values };
  if (!isIsoDay(values.until)) return { error: "invalidDate", field: "until", values };
  const reason = reasonSchema.safeParse(values.reason);
  if (!reason.success) return { error: "reason", field: "reason", values };

  try {
    await opExtendRetention({
      operatorId: guarded.session.operatorId,
      weddingId: guarded.weddingId,
      kind: kind.data,
      until: values.until,
      reason: reason.data,
    });
  } catch (error) {
    return failure(error, values);
  }
  done(guarded.weddingId, "extend");
}

export async function restoreWeddingAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard("restore", formData);
  if (!guarded.ok) return guarded.state;

  const values = { reason: text(formData, "reason") };
  const reason = reasonSchema.safeParse(values.reason);
  if (!reason.success) return { error: "reason", field: "reason", values };

  try {
    await opRestoreWedding({
      operatorId: guarded.session.operatorId,
      weddingId: guarded.weddingId,
      reason: reason.data,
    });
  } catch (error) {
    return failure(error, values);
  }
  done(guarded.weddingId, "restore");
}

export async function addNoteAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard("note", formData);
  if (!guarded.ok) return guarded.state;

  const values = { body: text(formData, "body") };
  const body = z.string().trim().min(1).max(2000).safeParse(values.body);
  if (!body.success) return { error: "invalidNote", field: "body", values };

  try {
    await opAddNote({
      operatorId: guarded.session.operatorId,
      weddingId: guarded.weddingId,
      body: body.data,
    });
  } catch (error) {
    return failure(error, values);
  }
  done(guarded.weddingId, "note");
}

export async function sendLoginLinkAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guarded = await guard("login_link", formData);
  if (!guarded.ok) return guarded.state;

  const adminId = idSchema.safeParse(text(formData, "adminId"));
  if (!adminId.success) return { error: "noAdmin", field: "adminId" };

  try {
    const detail = await opGetWedding(guarded.session.operatorId, guarded.weddingId);
    const admin = detail?.admins.find((a) => a.id === adminId.data && !a.removed_at);
    if (!detail || !admin) return { error: "notFound", field: "adminId" };

    const result = await sendAdminLoginLink({
      operator: guarded.session,
      weddingId: guarded.weddingId,
      adminId: admin.id,
      adminEmail: admin.email,
      locale: detail.wedding.default_locale === "en" ? "en" : "cs",
      origin: appOriginForAdminHost(await getHost(), currentHostConfig()),
      defer,
    });
    if (result.status === "limited") return { error: "limited" };
    if (result.status === "failed") return { error: "generic" };
  } catch (error) {
    return failure(error);
  }
  done(guarded.weddingId, "link");
}

export type GuestDataResult = { outcome: "denied" | "empty" | "rows"; rows: GuestDataRow[] };

/**
 * Nahlédnutí do údajů hostů: jen s aktivním souhlasem páru (`data_access_grants`), s důvodem, vždy s auditem.
 * Bez souhlasu databáze nevrátí nic a odmítnutí zapíše do auditu. Výsledek je jen v odpovědi této akce.
 */
export async function viewGuestDataAction(
  _previous: ActionState<GuestDataResult>,
  formData: FormData,
): Promise<ActionState<GuestDataResult>> {
  const guarded = await guard("guest_data", formData);
  if (!guarded.ok) return guarded.state;

  const values = { reason: text(formData, "reason") };
  const reason = reasonSchema.safeParse(values.reason);
  if (!reason.success) return { error: "reason", field: "reason", values };

  try {
    const byOperator = await rateLimitHit(
      rateKey(requireEnv("RATE_LIMIT_SECRET"), "op-guest-data", guarded.session.operatorId),
      OPERATOR_RATE_RULES.guestDataOperator.limit,
      OPERATOR_RATE_RULES.guestDataOperator.windowSeconds,
    );
    if (!byOperator.allowed) return { error: "limited", values };

    const detail = await opGetWedding(guarded.session.operatorId, guarded.weddingId);
    if (!detail) return { error: "notFound" };
    const rows = await opViewGuestData({
      operatorId: guarded.session.operatorId,
      weddingId: guarded.weddingId,
      reason: reason.data,
    });
    const outcome = rows.length > 0 ? "rows" : detail.guest_access === null ? "denied" : "empty";
    return { ok: true, data: { outcome, rows } };
  } catch (error) {
    return failure(error, values);
  }
}
