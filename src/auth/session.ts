import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { localHref } from "@/auth/local-href";
import {
  authCreateSession,
  authRevokeSession,
  authValidateSession,
  type ValidSession,
} from "@/lib/db/rpc";
import { ADMIN_SESSION } from "./config";
import { cookieSpec, expiredCookieSpec } from "./cookie";
import { generateToken, hashToken } from "./crypto";
import { getHost } from "./request";

/**
 * Relace správce (docs/adr/0002, varianta R1): neprůhledný token v cookie jen pro hostitele `app.`,
 * v databázi jen jeho hash. Jediné místo, kde se čte a zapisuje cookie relace.
 */

export const LOGIN_PATH = "/prihlaseni";

export type AdminSession = ValidSession & { kind: "admin"; subjectId: string };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Vydá novou relaci správce a nastaví cookie. Případnou starou relaci odvolá (fixace relace). */
export async function startAdminSession(weddingId: string, adminId: string): Promise<void> {
  const store = await cookies();
  const host = await getHost();
  const spec = cookieSpec("admin", host, ADMIN_SESSION.absoluteSeconds);

  const previous = store.get(spec.name)?.value;
  if (previous && TOKEN_PATTERN.test(previous)) {
    await authRevokeSession(hashToken(previous));
  }

  const token = generateToken();
  await authCreateSession({
    kind: "admin",
    weddingId,
    subjectId: adminId,
    tokenHash: hashToken(token),
    idleSeconds: ADMIN_SESSION.idleSeconds,
    absoluteSeconds: ADMIN_SESSION.absoluteSeconds,
  });
  store.set({ name: spec.name, value: token, ...spec.options });
}

/**
 * Aktuální relace správce, nebo `null`. Pro Server Components i Server Actions; v rámci jednoho
 * požadavku se ověří jednou. Každá Server Action ji musí zavolat sama (proxy není bezpečnostní hranice).
 */
export const getSession = cache(async (): Promise<AdminSession | null> => {
  const store = await cookies();
  const spec = cookieSpec("admin", await getHost());
  const token = store.get(spec.name)?.value;
  if (!token || !TOKEN_PATTERN.test(token)) return null;

  const session = await authValidateSession(hashToken(token));
  if (!session || session.kind !== "admin" || !session.subjectId) return null;
  return { ...session, kind: "admin", subjectId: session.subjectId };
});

/** Relace, nebo přesměrování na přihlášení. */
export async function requireSession(): Promise<AdminSession> {
  const session = await getSession();
  if (!session) redirect(await localHref(LOGIN_PATH));
  return session;
}

/** Odhlášení: odvolá relaci v databázi (smaže se na serveru) a zruší cookie. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  const host = await getHost();
  const spec = cookieSpec("admin", host);
  const token = store.get(spec.name)?.value;
  if (token && TOKEN_PATTERN.test(token)) {
    await authRevokeSession(hashToken(token));
  }
  const expired = expiredCookieSpec("admin", host);
  store.set({ name: expired.name, value: expired.value, ...expired.options });
}
