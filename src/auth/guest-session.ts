import "server-only";
import { cookies } from "next/headers";
import { authRevokeSession, authValidateSession } from "@/lib/db/rpc";
import type { TenantIdentity } from "@/lib/db/transport";
import { GUEST_SESSION } from "./config";
import { cookieSpec, expiredCookieSpec } from "./cookie";
import { hashToken } from "./crypto";
import { getHost } from "./request";

/**
 * Relace hosta po PINu (docs/adr/0002, docs/security-privacy.md kap. 1.3): neprůhledný token v cookie
 * `__Host-sv_guest` jen pro hostitele webu páru (bez `Domain`, `HttpOnly`, `Secure`, `SameSite=Lax`),
 * v databázi jen jeho hash. Platnost je krátká (`GUEST_SESSION`). Relace odemyká jen citlivé bloky
 * své svatby; správa ji nikdy nepřijme (`kind` je `guest_pin`, správcovská cookie se jmenuje jinak).
 * Jediné místo, kde se tato cookie čte a zapisuje.
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Nastaví cookie s tokenem z `unlockWithGuestPin`. Případnou starou relaci odvolá (fixace relace). */
export async function setGuestCookie(token: string): Promise<void> {
  const store = await cookies();
  const spec = cookieSpec("guest", await getHost(), GUEST_SESSION.absoluteSeconds);
  const previous = store.get(spec.name)?.value;
  if (previous && TOKEN_PATTERN.test(previous)) {
    await authRevokeSession(hashToken(previous));
  }
  store.set({ name: spec.name, value: token, ...spec.options });
}

export interface GuestAccess {
  sessionId: string;
  weddingId: string;
}

/** Platná relace hosta pro danou svatbu, nebo `null` (jiná svatba, prošlá, odvolaná, správcovská). */
export async function getGuestSession(weddingId: string): Promise<GuestAccess | null> {
  const store = await cookies();
  const token = store.get(cookieSpec("guest", await getHost()).name)?.value;
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const session = await authValidateSession(hashToken(token));
  if (!session || session.kind !== "guest_pin" || session.weddingId !== weddingId) return null;
  return { sessionId: session.sessionId, weddingId: session.weddingId };
}

/** Totožnost pro funkce databáze: host po PINu (subjektem je id relace). */
export function guestIdentity(access: GuestAccess): TenantIdentity {
  return { weddingId: access.weddingId, weddingRole: "guest_pin", subject: access.sessionId };
}

/** Odhlášení hosta (relace se odvolá na serveru, cookie zanikne). */
export async function endGuestSession(): Promise<void> {
  const store = await cookies();
  const host = await getHost();
  const spec = cookieSpec("guest", host);
  const token = store.get(spec.name)?.value;
  if (token && TOKEN_PATTERN.test(token)) {
    await authRevokeSession(hashToken(token));
  }
  const expired = expiredCookieSpec("guest", host);
  store.set({ name: expired.name, value: expired.value, ...expired.options });
}
