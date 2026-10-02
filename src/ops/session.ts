import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieSpec, expiredCookieSpec } from "@/auth/cookie";
import { generateToken, hashToken } from "@/auth/crypto";
import { assertSameOrigin, getHost } from "@/auth/request";
import {
  authOperatorCreateSession,
  authOperatorRevokeSession,
  authOperatorValidateSession,
  type ValidOperatorSession,
} from "@/lib/db/rpc-ops";
import { OPERATOR_SESSION } from "./config";
import { can, type OperatorAction } from "./roles";

/**
 * Relace operátora (docs/adr/0012): neprůhledný token v cookie `__Host-sv_operator` jen pro hostitele
 * `admin.` (host-only, HttpOnly, Secure, SameSite=Lax), v databázi jen jeho SHA-256. Nečinnost 30 minut,
 * absolutně 8 hodin. Po kódu z e-mailu je relace jen AAL1; všechno kromě stránek druhého faktoru
 * vyžaduje AAL2 (`requireOperator`, `authorizeOperator`) a kontroluje se při každém požadavku i zásahu.
 */

export const OPERATOR_LOGIN_PATH = "/prihlaseni";
export const OPERATOR_MFA_PATH = "/prihlaseni/overeni";
export const OPERATOR_ENROLL_PATH = "/prihlaseni/faktor";

export type OperatorSession = ValidOperatorSession;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Vydá novou relaci operátora (AAL1) a nastaví cookie; případnou starou relaci odvolá (fixace relace). */
export async function startOperatorSession(operatorId: string): Promise<void> {
  const store = await cookies();
  const host = await getHost();
  const spec = cookieSpec("operator", host, OPERATOR_SESSION.absoluteSeconds);

  const previous = store.get(spec.name)?.value;
  if (previous && TOKEN_PATTERN.test(previous)) {
    await authOperatorRevokeSession(hashToken(previous));
  }

  const token = generateToken();
  await authOperatorCreateSession({
    operatorId,
    tokenHash: hashToken(token),
    idleSeconds: OPERATOR_SESSION.idleSeconds,
    absoluteSeconds: OPERATOR_SESSION.absoluteSeconds,
  });
  store.set({ name: spec.name, value: token, ...spec.options });
}

/** Aktuální relace (AAL1 nebo AAL2), nebo `null`. V rámci jednoho požadavku se ověří jednou. */
export const getOperatorSession = cache(async (): Promise<OperatorSession | null> => {
  const store = await cookies();
  const token = store.get(cookieSpec("operator", await getHost()).name)?.value;
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  return authOperatorValidateSession(hashToken(token));
});

/** Kam patří relace, která ještě nemá druhý faktor. */
export function pendingFactorPath(session: OperatorSession): string {
  return session.totpConfirmed ? OPERATOR_MFA_PATH : OPERATOR_ENROLL_PATH;
}

/**
 * Relace AAL2 pro stránky administrace, jinak přesměrování (přihlášení, nebo druhý faktor). Zásahy to
 * nenahrazuje: každá Server Action volá `authorizeOperator` sama (proxy ani layout nejsou bezpečnostní hranice).
 */
export async function requireOperator(action: OperatorAction = "view"): Promise<OperatorSession> {
  const session = await getOperatorSession();
  if (!session) redirect(OPERATOR_LOGIN_PATH);
  if (!session.aal2) redirect(pendingFactorPath(session));
  if (!can(session.role, action)) redirect("/");
  return session;
}

/** Relace AAL1 pro stránky druhého faktoru: bez relace na přihlášení, s AAL2 do administrace. */
export async function requireFirstFactor(): Promise<OperatorSession> {
  const session = await getOperatorSession();
  if (!session) redirect(OPERATOR_LOGIN_PATH);
  if (session.aal2) redirect("/");
  return session;
}

export type AuthorizeResult =
  | { ok: true; session: OperatorSession }
  | { ok: false; reason: "origin" | "session" | "forbidden" };

/**
 * Začátek každé Server Action operátora: shodný původ (CSRF), platná relace AAL2 a oprávnění role.
 * Nikdy nevyhazuje; akce vrátí chybu formuláře. Role se ověřuje znovu i v databázi (`op_*`).
 */
export async function authorizeOperator(action: OperatorAction): Promise<AuthorizeResult> {
  try {
    await assertSameOrigin();
  } catch {
    return { ok: false, reason: "origin" };
  }
  const session = await getOperatorSession();
  if (!session || !session.aal2) return { ok: false, reason: "session" };
  if (!can(session.role, action)) return { ok: false, reason: "forbidden" };
  return { ok: true, session };
}

/** Odhlášení: odvolá relaci v databázi a zruší cookie. */
export async function endOperatorSession(): Promise<void> {
  const store = await cookies();
  const host = await getHost();
  const token = store.get(cookieSpec("operator", host).name)?.value;
  if (token && TOKEN_PATTERN.test(token)) {
    await authOperatorRevokeSession(hashToken(token));
  }
  const expired = expiredCookieSpec("operator", host);
  store.set({ name: expired.name, value: expired.value, ...expired.options });
}
