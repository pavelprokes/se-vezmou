"use server";

import { localHref } from "@/auth/local-href";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { cookieSpec, expiredCookieSpec } from "@/auth/cookie";
import { normalizeEmail, parseCode } from "@/auth/identity";
import type { Defer } from "@/auth/login";
import { assertSameOrigin, getClientIp, getHost, getUiLocale } from "@/auth/request";
import { formatPause } from "@/i18n/duration";
import { OPERATOR_PENDING_SECONDS } from "../config";
import {
  confirmEnrollment,
  openOperatorPending,
  regenerateBackupCodes,
  requestOperatorCode,
  sealOperatorPending,
  verifyOperatorCode,
  verifySecondFactor,
} from "../login";
import {
  OPERATOR_ENROLL_PATH,
  OPERATOR_LOGIN_PATH,
  OPERATOR_MFA_PATH,
  authorizeOperator,
  endOperatorSession,
  getOperatorSession,
  startOperatorSession,
} from "../session";
import type { ActionState } from "../ui/action-form";

/**
 * Server Actions přihlášení operátora. Každá začíná kontrolou původu (CSRF) a sama si ověřuje relaci:
 * proxy ani layout nejsou bezpečnostní hranice. Odpovědi neprozradí, zda e-mail patří operátorovi.
 * Do záznamů serveru se nikdy nedostane e-mail, kód ani klíč.
 */

const defer: Defer = (task) =>
  after(async () => {
    await task();
  });

async function originAllowed(): Promise<boolean> {
  try {
    await assertSameOrigin();
    return true;
  } catch {
    return false;
  }
}

async function clearPending(): Promise<void> {
  const expired = expiredCookieSpec("operatorPending", await getHost());
  (await cookies()).set({ name: expired.name, value: expired.value, ...expired.options });
}

/** 1. krok: e-mail -> kód do schránky. Odpověď je stejná pro známý i neznámý e-mail. */
export async function requestOperatorCodeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await originAllowed())) return { error: "generic" };

  const raw = formData.get("email");
  const email = normalizeEmail(raw);
  if (!email) {
    return {
      error: "invalidEmail",
      field: "email",
      values: { email: typeof raw === "string" ? raw : "" },
    };
  }

  const result = await requestOperatorCode({ email, ip: await getClientIp(), defer });
  if (result.status === "limited") return { error: "limited", values: { email } };

  const host = await getHost();
  const spec = cookieSpec("operatorPending", host, OPERATOR_PENDING_SECONDS);
  (await cookies()).set({ name: spec.name, value: sealOperatorPending(email), ...spec.options });
  redirect(await localHref("/prihlaseni/kod"));
}

/** 2. krok: šestimístný kód z e-mailu -> relace AAL1 a přesměrování na druhý faktor. */
export async function verifyOperatorCodeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await originAllowed())) return { error: "generic" };

  const pending = (await cookies()).get(cookieSpec("operatorPending", await getHost()).name)?.value;
  const email = pending ? openOperatorPending(pending) : null;
  if (!email) return { error: "expired" };

  const code = parseCode(formData.get("code"));
  if (!code) return { error: "format", field: "code" };

  const result = await verifyOperatorCode({ email, code, ip: await getClientIp() });
  if (result.status === "limited") return { error: "limited" };
  if (result.status === "invalid") return { error: "wrong", field: "code" };

  await startOperatorSession(result.operatorId);
  await clearPending();
  redirect(await localHref(result.totpConfirmed ? OPERATOR_MFA_PATH : OPERATOR_ENROLL_PATH));
}

/** 3. krok: kód z aplikace TOTP nebo záložní kód -> AAL2. */
export async function secondFactorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await originAllowed())) return { error: "generic" };
  const session = await getOperatorSession();
  if (!session || session.aal2) return { error: "session" };
  if (!session.totpConfirmed) redirect(await localHref(OPERATOR_ENROLL_PATH));

  const result = await verifySecondFactor({
    session,
    value: formData.get("code"),
    ip: await getClientIp(),
    defer,
  });
  switch (result.status) {
    case "ok":
      redirect(await localHref("/"));
    case "format":
      return { error: "format", field: "code" };
    case "invalid":
      return { error: "invalid", field: "code" };
    case "locked":
      return { error: "locked", pause: formatPause(result.retryAfter, await getUiLocale()) };
    case "limited":
      return { error: "limited" };
  }
}

export type CodesData = { codes: string[] };

/** První přihlášení: potvrzení zápisu druhého faktoru kódem z aplikace; vrátí záložní kódy k jednorázovému zobrazení. */
export async function enrollAction(
  _previous: ActionState<CodesData>,
  formData: FormData,
): Promise<ActionState<CodesData>> {
  if (!(await originAllowed())) return { error: "generic" };
  const session = await getOperatorSession();
  if (!session || session.aal2) return { error: "session" };

  const result = await confirmEnrollment({
    session,
    value: formData.get("code"),
    ip: await getClientIp(),
    defer,
  });
  switch (result.status) {
    case "ok":
      return { ok: true, data: { codes: result.backupCodes } };
    case "format":
      return { error: "format", field: "code" };
    case "invalid":
      return { error: "invalid", field: "code" };
    case "locked":
      return { error: "locked", pause: formatPause(result.retryAfter, await getUiLocale()) };
    case "limited":
      return { error: "limited" };
  }
}

/** Nová sada záložních kódů pro přihlášeného operátora (AAL2); vyžaduje aktuální kód z aplikace. */
export async function regenerateCodesAction(
  _previous: ActionState<CodesData>,
  formData: FormData,
): Promise<ActionState<CodesData>> {
  const auth = await authorizeOperator("view");
  if (!auth.ok) return { error: auth.reason };
  const result = await regenerateBackupCodes({
    session: auth.session,
    value: formData.get("code"),
    ip: await getClientIp(),
    defer,
  });
  switch (result.status) {
    case "ok":
      return { ok: true, data: { codes: result.backupCodes } };
    case "format":
      return { error: "format", field: "code" };
    case "invalid":
      return { error: "invalid", field: "code" };
    case "locked":
      return { error: "locked", pause: formatPause(result.retryAfter, await getUiLocale()) };
    case "limited":
      return { error: "limited" };
  }
}

/** Odhlášení: relace se odvolá na serveru a cookie zanikne. */
export async function logoutAction(): Promise<void> {
  if (await originAllowed()) {
    await endOperatorSession();
  }
  redirect(await localHref(OPERATOR_LOGIN_PATH));
}
