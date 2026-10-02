import "server-only";
import { requireEnv } from "@/env";
import {
  authCreateSession,
  authPinGet,
  lockoutFailure,
  lockoutReset,
  lockoutState,
  rateLimitHit,
} from "@/lib/db/rpc";
import { GUEST_SESSION, PIN_LOCKOUT, RATE_RULES } from "./config";
import { generateToken, hashToken } from "./crypto";
import { getDummyHash, verifyPin } from "./pin";
import { rateKey } from "./rate-limit";

/**
 * PIN hostů (FR-PRIV-2, docs/security-privacy.md kap. 1.2, ADR 0010). Odemyká jen citlivé bloky
 * webu páru (číslo účtu, soukromá adresa), nikdy správu. Zásady:
 *  - pauza po chybách je podle svatby a IP: 5 chyb, pak 15 minut, každá další série dvojnásobek, strop
 *    24 hodin (`PIN_LOCKOUT`); ostatní hosté na jiné IP pauzou nejsou postiženi,
 *  - navíc pauza po 50 chybách za celou svatbu (součet všech IP), aby nešlo PIN zkoušet z mnoha adres;
 *    úspěšné zadání čítače nuluje, takže poctivé překlepy hostů k pauze nikdy nedojdou,
 *  - svatba bez PINu, neexistující svatba i chybný PIN stojí stejný výpočet (argon2id) a vrací totéž,
 *  - selhání úložiště omezení selže zavřeně (host se nepřihlásí),
 *  - úspěch vydá relaci hosta (neprůhledný token, v databázi jen hash); cookie řeší volající.
 */

export type GuestPinResult =
  | { status: "ok"; token: string; sessionId: string }
  | { status: "invalid" }
  | { status: "locked"; retryAfter: number }
  | { status: "limited"; retryAfter: number };

export async function unlockWithGuestPin(input: {
  weddingId: string;
  /** Slug z hostitele; klíče omezení jsou HMAC, v databázi tedy žádný slug ani IP. */
  slug: string;
  pin: string;
  ip: string;
}): Promise<GuestPinResult> {
  const pepper = requireEnv("PIN_PEPPER");
  const limitSecret = requireEnv("RATE_LIMIT_SECRET");

  const where = `${input.slug}\0${input.ip}`;
  const byIp = await rateLimitHit(
    rateKey(limitSecret, "pin-guest-ip", where),
    RATE_RULES.pinGuestIp.limit,
    RATE_RULES.pinGuestIp.windowSeconds,
  );
  if (!byIp.allowed) return { status: "limited", retryAfter: byIp.retryAfter };

  const lockKey = rateKey(limitSecret, "pin-guest-wedding-ip", where);
  const weddingKey = rateKey(limitSecret, "pin-guest-wedding", input.slug);
  const [ipState, weddingState] = await Promise.all([
    lockoutState(lockKey),
    lockoutState(weddingKey),
  ]);
  if (ipState.locked) return { status: "locked", retryAfter: ipState.retryAfter };
  if (weddingState.locked) return { status: "locked", retryAfter: weddingState.retryAfter };

  const record = await authPinGet(input.slug, "guest");
  const matches = await verifyPin(
    record?.pinHash ?? (await getDummyHash(pepper)),
    input.pin,
    pepper,
  );

  if (!record || record.weddingId !== input.weddingId || !matches) {
    // Chyba se počítá hostu (svatba + IP) i celé svatbě; úspěch kteréhokoli hosta čítače nuluje,
    // takže poctivé překlepy v součtu nikdy nedojdou k pauze.
    const [failure, total] = await Promise.all([
      lockoutFailure(lockKey, PIN_LOCKOUT),
      lockoutFailure(weddingKey, {
        ...PIN_LOCKOUT,
        threshold: RATE_RULES.pinGuestWeddingFailures.limit,
      }),
    ]);
    if (failure.locked) return { status: "locked", retryAfter: failure.retryAfter };
    if (total.locked) return { status: "locked", retryAfter: total.retryAfter };
    return { status: "invalid" };
  }

  await Promise.all([lockoutReset(lockKey), lockoutReset(weddingKey)]);
  const token = generateToken();
  const sessionId = await authCreateSession({
    kind: "guest_pin",
    weddingId: record.weddingId,
    subjectId: null,
    tokenHash: hashToken(token),
    idleSeconds: GUEST_SESSION.idleSeconds,
    absoluteSeconds: GUEST_SESSION.absoluteSeconds,
  });
  return { status: "ok", token, sessionId };
}
