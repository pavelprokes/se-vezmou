import type { RateRule } from "@/auth/config";

/**
 * Lhůty a limity přihlášení operátorů na jednom místě (docs/adr/0008, 0010, 0012, docs/security-privacy.md).
 * Hodnoty jsou výchozí návrh k ladění po spuštění.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Relace operátora: nečinnost 30 minut, absolutně 8 hodin (ADR 0008). */
export const OPERATOR_SESSION = {
  idleSeconds: 30 * MINUTE,
  absoluteSeconds: 8 * HOUR,
} as const;

/** Kód z e-mailu: stejná pravidla jako u správců (10 minut, jednou, pět pokusů), jiný účel výzvy. */
export const OPERATOR_CODE = {
  ttlSeconds: 10 * MINUTE,
  length: 6,
  maxAttempts: 5,
} as const;

/** Omezení počtu požadavků operátorské cesty; klíče jsou HMAC (`src/auth/rate-limit.ts`). */
export const OPERATOR_RATE_RULES = {
  /** Vyžádání kódu podle e-mailu: při překročení stejná odpověď, kód se neposílá. */
  codeRequestEmail: { limit: 5, windowSeconds: HOUR },
  codeRequestIp: { limit: 20, windowSeconds: HOUR },
  codeVerifyIp: { limit: 30, windowSeconds: HOUR },
  /** Druhý faktor (TOTP nebo záložní kód) podle IP a podle operátora. */
  mfaIp: { limit: 30, windowSeconds: HOUR },
  /** Poslání přihlašovacího odkazu správci: podle správce (ochrana před zahlcením jeho schránky). */
  loginLinkAdmin: { limit: 5, windowSeconds: HOUR },
  loginLinkOperator: { limit: 30, windowSeconds: HOUR },
  /** Nahlédnutí do údajů hostů podle operátora. */
  guestDataOperator: { limit: 30, windowSeconds: HOUR },
} as const satisfies Record<string, RateRule>;

/**
 * Pauza po chybách druhého faktoru podle operátora (stejný postup jako u PINu: 5 chyb, 15 minut,
 * dvojnásobek každou sérii, strop 24 hodin). Rozhoduje databáze (`auth_lockout_failure`).
 */
export const OPERATOR_MFA_LOCKOUT = {
  threshold: 5,
  baseSeconds: 15 * MINUTE,
  maxSeconds: DAY,
} as const;

/** Rozepsané přihlášení v prohlížeči (e-mail po vyžádání kódu), stejná platnost jako kód. */
export const OPERATOR_PENDING_SECONDS = OPERATOR_CODE.ttlSeconds;

/** Název v aplikaci TOTP (řádek účtu). */
export const TOTP_ISSUER = "Se vezmou (provoz)";

/** Stránkování seznamů v administraci. */
export const PAGE_SIZE = 25;
export const AUDIT_PAGE_SIZE = 50;

/** Platnost přihlašovacího odkazu poslaného správci (jako běžný kód). */
export const LOGIN_LINK_TTL_SECONDS = OPERATOR_CODE.ttlSeconds;

/** Okno seznamu blížících se lhůt v dnech (FR-OPS-5). */
export const RETENTION_WINDOW_DAYS = 60;

/** Okno souhrnu analytiky ve dnech. */
export const ANALYTICS_WINDOW_DAYS = 30;
