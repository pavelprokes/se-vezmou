/**
 * Lhůty a limity přihlášení na jednom místě (docs/adr/0010-rate-limiting.md: "limity jsou
 * konfigurace v jednom souboru, ne rozseté konstanty"). Hodnoty jsou výchozí návrh k ladění po betě.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Relace správce (docs/security-privacy.md kap. 1.3): nečinnost 14 dní, absolutně 60 dní. */
export const ADMIN_SESSION = {
  idleSeconds: 14 * DAY,
  absoluteSeconds: 60 * DAY,
} as const;

/** Jednorázový kód a odkaz: platnost 10 minut, po pěti chybách se výzva zneplatní (v databázi). */
export const LOGIN_CODE = {
  ttlSeconds: 10 * MINUTE,
  length: 6,
  maxAttempts: 5,
} as const;

export interface RateRule {
  /** Povolený počet požadavků v okně. */
  limit: number;
  windowSeconds: number;
}

/** Omezení počtu požadavků (ADR 0010, tabulka limitů). Klíče jsou HMAC, viz `rate-limit.ts`. */
export const RATE_RULES = {
  /** Vyžádání kódu podle e-mailu: při překročení stejná odpověď, kód se neposílá. */
  loginRequestEmail: { limit: 5, windowSeconds: HOUR },
  /** Vyžádání kódu podle IP. */
  loginRequestIp: { limit: 20, windowSeconds: HOUR },
  /** Ověření kódu podle IP. */
  loginVerifyIp: { limit: 30, windowSeconds: HOUR },
  /** PIN správy podle IP (počítají se všechny pokusy, úspěšné přihlášení PINem je řídké). */
  pinAdminIp: { limit: 20, windowSeconds: HOUR },
  /** PIN hostů podle svatby a IP (hosté na jedné Wi-Fi: volnější než PIN správy). */
  pinGuestIp: { limit: 60, windowSeconds: HOUR },
  /** PIN hostů: součet chyb za všechny IP jedné svatby. */
  pinGuestWeddingFailures: { limit: 50, windowSeconds: HOUR },
} as const satisfies Record<string, RateRule>;

/**
 * Pauzy po chybách PINu: 5 chyb, pauza 15 minut, každá další série dvojnásobná, strop 24 hodin
 * (`[OTÁZKA]` pro majitele). Rozhoduje databáze (`auth_lockout_failure`); `pauseSeconds` je
 * stejný výpočet pro popisy a testy.
 */
export const PIN_LOCKOUT = {
  threshold: 5,
  baseSeconds: 15 * MINUTE,
  maxSeconds: DAY,
} as const;

export function pauseSeconds(level: number, lockout = PIN_LOCKOUT): number {
  if (!Number.isInteger(level) || level < 1) return 0;
  return Math.min(lockout.maxSeconds, lockout.baseSeconds * 2 ** Math.min(level - 1, 30));
}

/** PIN: nejméně šest číslic (docs/security-privacy.md kap. 1.2). */
export const PIN_LENGTH = { min: 6, max: 12 } as const;

/** Rozpracované přihlášení v prohlížeči (e-mail po vyžádání kódu), stejná platnost jako kód. */
export const PENDING_LOGIN_SECONDS = LOGIN_CODE.ttlSeconds;
