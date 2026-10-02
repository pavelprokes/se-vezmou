import "server-only";
import { requireEnv } from "@/env";
import type { Locale } from "@/i18n/config";
import {
  authPinGet,
  authPinOtherHash,
  authPinSet,
  lockoutFailure,
  lockoutReset,
  lockoutState,
  rateLimitHit,
  type PinRole,
} from "@/lib/db/rpc";
import { sendTemplatedEmail } from "@/lib/email/send";
import { renderBackupLoginNotice } from "@/lib/email/templates";
import { currentHostConfig, siteHostname } from "./app-origin";
import { PIN_LOCKOUT, RATE_RULES } from "./config";
import type { Defer } from "./login";
import { rateKey } from "./rate-limit";
import { getDummyHash, hashPin, pinProblem, verifyPin, type PinProblem } from "./pin";

/**
 * Přihlášení PINem a správa PINů (docs/security-privacy.md kap. 1.2, ADR 0010). Zásady:
 *  - pauza po chybách (5 chyb, 15 minut, dvojnásobek každou sérii, strop 24 hodin) je podle svatby
 *    (klíč HMAC slugu), takže platí stejně pro existující i neexistující adresu,
 *  - neznámá svatba, svatba bez PINu i chybný PIN stojí stejný výpočet (argon2id) a vrací totéž,
 *  - každé přihlášení PINem i pauza po sérii chyb se oznámí na záložní e-mail,
 *  - pauza PINu nebrání přihlášení kódem z e-mailu (nezávislá cesta).
 */

export type PinLoginResult =
  | { status: "ok"; weddingId: string; adminId: string }
  | { status: "invalid" }
  | { status: "locked"; retryAfter: number }
  | { status: "limited"; retryAfter: number };

export async function loginWithPin(input: {
  /** Slug po `parseSlug`; `null` = neplatný tvar (nemůže existovat). */
  slug: string | null;
  pin: string;
  ip: string;
  locale: Locale;
  origin: string;
  defer: Defer;
}): Promise<PinLoginResult> {
  const pepper = requireEnv("PIN_PEPPER");
  const limitSecret = requireEnv("RATE_LIMIT_SECRET");
  const authSecret = requireEnv("AUTH_SECRET");

  const byIp = await rateLimitHit(
    rateKey(limitSecret, "pin-admin-ip", input.ip),
    RATE_RULES.pinAdminIp.limit,
    RATE_RULES.pinAdminIp.windowSeconds,
  );
  if (!byIp.allowed) return { status: "limited", retryAfter: byIp.retryAfter };

  if (input.slug === null) {
    await verifyPin(await getDummyHash(pepper), input.pin, pepper);
    return { status: "invalid" };
  }

  const lockKey = rateKey(limitSecret, "pin-admin-wedding", input.slug);
  const state = await lockoutState(lockKey);
  if (state.locked) return { status: "locked", retryAfter: state.retryAfter };

  const record = await authPinGet(input.slug, "admin");
  const matches = await verifyPin(
    record?.pinHash ?? (await getDummyHash(pepper)),
    input.pin,
    pepper,
  );

  if (!record || !record.adminId || !matches) {
    const failure = await lockoutFailure(lockKey, PIN_LOCKOUT);
    if (failure.newlyLocked && record) {
      const config = currentHostConfig();
      const email = renderBackupLoginNotice({
        locale: input.locale,
        event: "pin_locked",
        at: new Date(),
        site: siteHostname(input.slug, config),
        pauseSeconds: failure.retryAfter,
        loginUrl: `${input.origin}/prihlaseni`,
      });
      input.defer(() =>
        sendTemplatedEmail({
          type: "backup_login_notice",
          to: record.backupEmail,
          weddingId: record.weddingId,
          locale: input.locale,
          email,
          secret: authSecret,
        }),
      );
    }
    return failure.locked
      ? { status: "locked", retryAfter: failure.retryAfter }
      : { status: "invalid" };
  }

  await lockoutReset(lockKey);

  const email = renderBackupLoginNotice({
    locale: input.locale,
    event: "pin_login",
    at: new Date(),
    site: siteHostname(input.slug, currentHostConfig()),
    loginUrl: `${input.origin}/prihlaseni`,
  });
  input.defer(() =>
    sendTemplatedEmail({
      type: "backup_login_notice",
      to: record.backupEmail,
      weddingId: record.weddingId,
      locale: input.locale,
      email,
      secret: authSecret,
    }),
  );
  return { status: "ok", weddingId: record.weddingId, adminId: record.adminId };
}

export type SetPinResult =
  | { status: "ok"; backupEmail: string }
  | { status: "invalid"; problem: PinProblem | "same_as_other" };

/**
 * Nastavení nebo změna PINu přihlášenou relací správce. PIN správy a PIN hostů nesmějí být
 * stejné: nový PIN se porovná s hashem druhého PINu (hash je solený, proto až v aplikaci).
 * Odvolá ostatní relace dotčené role a zapíše audit (v databázi).
 */
export async function setPin(input: {
  weddingId: string;
  /** Adresa webu pro popis v e-mailu, je-li už přidělená. */
  slug: string | null;
  role: PinRole;
  pin: string;
  actorAdminId: string;
  keepSessionId: string;
  locale: Locale;
  origin: string;
  defer: Defer;
}): Promise<SetPinResult> {
  const pepper = requireEnv("PIN_PEPPER");
  const authSecret = requireEnv("AUTH_SECRET");

  const problem = pinProblem(input.pin);
  if (problem) return { status: "invalid", problem };

  const otherHash = await authPinOtherHash(input.weddingId, input.role);
  if (otherHash && (await verifyPin(otherHash, input.pin, pepper))) {
    return { status: "invalid", problem: "same_as_other" };
  }

  const backupEmail = await authPinSet({
    weddingId: input.weddingId,
    role: input.role,
    hash: await hashPin(input.pin, pepper),
    actorAdminId: input.actorAdminId,
    keepSessionId: input.keepSessionId,
  });

  const email = renderBackupLoginNotice({
    locale: input.locale,
    event: "pin_changed",
    pinRole: input.role,
    at: new Date(),
    site: input.slug ? siteHostname(input.slug, currentHostConfig()) : undefined,
    loginUrl: `${input.origin}/prihlaseni`,
  });
  input.defer(() =>
    sendTemplatedEmail({
      type: "backup_login_notice",
      to: backupEmail,
      weddingId: input.weddingId,
      locale: input.locale,
      email,
      secret: authSecret,
    }),
  );
  return { status: "ok", backupEmail };
}
