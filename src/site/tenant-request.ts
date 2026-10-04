import "server-only";
import { cookies, headers } from "next/headers";
import { currentHostConfig } from "@/auth/app-origin";
import { INVITE_COOKIE_SECONDS, RSVP_TICKET_SECONDS } from "@/auth/config";
import { cookieSpec, expiredCookieSpec } from "@/auth/cookie";
import { assertSameOrigin, getHost } from "@/auth/request";
import { resolveHost } from "@/host/resolve";
import { isLocale, defaultLocale, type Locale } from "@/i18n/config";
import { resolveSlug } from "@/lib/db/rpc";
import { inviteTicket } from "@/lib/rsvp/db";
import { originFromHeaders } from "./origin";

/**
 * Společné kroky Server Actions webu páru: kontrola původu (CSRF), určení svatby z hostitele (nikdy
 * z těla požadavku), jazyk a cookie lístku RSVP. Proxy není bezpečnostní hranice (docs/adr/0002),
 * proto každá akce začíná tady.
 */

export interface TenantRequest {
  slug: string;
  weddingId: string;
  locale: Locale;
  origin: string;
}

/** Svatba z hostitele požadavku, nebo `null` (jiný druh hostitele, neexistující či nezveřejněný web). */
export async function tenantFromRequest(localeField: unknown): Promise<TenantRequest | null> {
  try {
    await assertSameOrigin();
  } catch {
    return null;
  }
  const host = await getHost();
  const resolution = resolveHost(host, currentHostConfig());
  if (resolution.kind !== "tenant") return null;

  const resolved = await resolveSlug(resolution.slug);
  if (!resolved) return null;

  const h = await headers();
  const locale =
    typeof localeField === "string" && isLocale(localeField) ? localeField : defaultLocale;
  return {
    slug: resolution.slug,
    weddingId: resolved.weddingId,
    locale,
    origin: originFromHeaders(h.get("host"), h.get("x-forwarded-proto")),
  };
}

const TICKET_PATTERN = /^[0-9a-f]{64}$/;

/** Lístek RSVP z cookie (jen tvar; platnost ověří databáze). */
export async function readTicket(): Promise<string | null> {
  const value = (await cookies()).get(cookieSpec("rsvp", await getHost()).name)?.value;
  return value && TICKET_PATTERN.test(value) ? value : null;
}

/** Lístek do cookie: host-only, `HttpOnly`, stejně dlouhý jako lístek v databázi (30 minut). */
export async function setTicket(ticket: string): Promise<void> {
  const spec = cookieSpec("rsvp", await getHost(), RSVP_TICKET_SECONDS);
  (await cookies()).set({ name: spec.name, value: ticket, ...spec.options });
}

export async function clearTicket(): Promise<void> {
  const expired = expiredCookieSpec("rsvp", await getHost());
  (await cookies()).set({ name: expired.name, value: expired.value, ...expired.options });
}

// --- osobní odkaz domácnosti -----------------------------------------------------------------

export const INVITE_PATTERN = /^[0-9a-f]{20}$/;

/** Kód osobního odkazu z cookie (jen tvar; platnost ověří databáze). */
export async function readInvite(): Promise<string | null> {
  const value = (await cookies()).get(cookieSpec("invite", await getHost()).name)?.value;
  return value && INVITE_PATTERN.test(value) ? value : null;
}

/** Kód do cookie (host-only, `HttpOnly`); dřívější lístek se zahodí, mohl patřit jiné domácnosti. */
export async function setInvite(code: string): Promise<void> {
  const host = await getHost();
  const spec = cookieSpec("invite", host, INVITE_COOKIE_SECONDS);
  const store = await cookies();
  store.set({ name: spec.name, value: code, ...spec.options });
  const expired = expiredCookieSpec("rsvp", host);
  store.set({ name: expired.name, value: expired.value, ...expired.options });
}

export async function clearInvite(): Promise<void> {
  const expired = expiredCookieSpec("invite", await getHost());
  (await cookies()).set({ name: expired.name, value: expired.value, ...expired.options });
}

/**
 * Lístek RSVP pro tento požadavek: z kódu osobního odkazu (vydá se nový, takže nevyprší), jinak z cookie
 * po ověření jména. Obojí najednou patří vždy téže domácnosti: otevření odkazu lístek v cookie zahodí
 * a „Zadat jiné jméno“ zahodí kód. Lístek z kódu se do cookie neukládá (při vykreslení stránky to nejde),
 * každý krok si vydá vlastní.
 */
export async function currentTicket(weddingId: string): Promise<string | null> {
  const code = await readInvite();
  if (code) {
    const ticket = await inviteTicket(weddingId, code);
    if (ticket) return ticket;
  }
  return readTicket();
}
