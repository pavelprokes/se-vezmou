"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizeEmail } from "@/auth/identity";
import { opCreateOperator, opResetOperatorMfa, opSetOperatorDisabled } from "@/lib/db/rpc-ops";
import { opsErrorField, opsErrorKey } from "../errors";
import { authorizeOperator } from "../session";
import type { ActionState } from "../ui/action-form";

/**
 * Server Actions správy operátorů (jen majitel; role se ověří na serveru i v databázi). Každý zásah
 * zapíše audit v téže transakci. E-mail operátora se nikdy nezapisuje do auditu ani do záznamů serveru.
 */

const idSchema = z.uuid();
const reasonSchema = z.string().trim().min(1).max(500);

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failure(error: unknown, values?: Record<string, string>): NonNullable<ActionState> {
  const key = opsErrorKey(error);
  return { error: key, field: opsErrorField(key), values };
}

function done(): NonNullable<ActionState> {
  revalidatePath("/h/admin/operatori");
  return { ok: true };
}

export async function createOperatorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorizeOperator("manage_operators");
  if (!auth.ok) return { error: auth.reason };

  const raw = text(formData, "email");
  const values = { email: raw, role: text(formData, "role") };
  const email = normalizeEmail(raw);
  if (!email) return { error: "invalidEmail", field: "email", values };
  const role = z.enum(["owner", "support"]).safeParse(values.role);
  if (!role.success) return { error: "invalidRole", field: "role", values };

  try {
    await opCreateOperator({ ownerId: auth.session.operatorId, email, role: role.data });
  } catch (error) {
    return failure(error, values);
  }
  return done();
}

export async function setOperatorDisabledAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorizeOperator("manage_operators");
  if (!auth.ok) return { error: auth.reason };

  const values = {
    targetId: text(formData, "targetId"),
    mode: text(formData, "mode"),
    reason: text(formData, "reason"),
  };
  const targetId = idSchema.safeParse(values.targetId);
  if (!targetId.success) return { error: "notFound", field: "targetId", values };
  const mode = z.enum(["disable", "enable"]).safeParse(values.mode);
  if (!mode.success) return { error: "invalidKind", field: "mode", values };
  const reason = reasonSchema.safeParse(values.reason);
  if (!reason.success) return { error: "reason", field: "reason", values };

  try {
    await opSetOperatorDisabled({
      ownerId: auth.session.operatorId,
      targetId: targetId.data,
      disabled: mode.data === "disable",
      reason: reason.data,
    });
  } catch (error) {
    return failure(error, values);
  }
  return { ...done(), values: { mode: mode.data } };
}

export async function resetOperatorMfaAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorizeOperator("manage_operators");
  if (!auth.ok) return { error: auth.reason };

  const values = { targetId: text(formData, "targetId"), reason: text(formData, "reason") };
  const targetId = idSchema.safeParse(values.targetId);
  if (!targetId.success) return { error: "notFound", field: "targetId", values };
  const reason = reasonSchema.safeParse(values.reason);
  if (!reason.success) return { error: "reason", field: "reason", values };

  try {
    await opResetOperatorMfa({
      ownerId: auth.session.operatorId,
      targetId: targetId.data,
      reason: reason.data,
    });
  } catch (error) {
    return failure(error, values);
  }
  return done();
}
