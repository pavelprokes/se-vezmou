import { hmac } from "./crypto";

/**
 * Klíče omezení počtu požadavků (docs/adr/0010): HMAC s tajnou hodnotou RATE_LIMIT_SECRET, takže
 * v databázi nejsou surové IP, e-maily ani slugy. Čistý modul; volání databáze je v `limits.ts`.
 */

/** `scope:HMAC` (base64url, 43 znaků), dohromady hluboko pod 200 znaky z `rate_limits.bucket_key`. */
export function rateKey(secret: string, scope: string, value: string): string {
  return `${scope}:${hmac(secret, `rate:${scope}`, value).toString("base64url")}`;
}

export interface RateOutcome {
  allowed: boolean;
  /** Za kolik sekund to jde zkusit znovu (0 u povolených). */
  retryAfter: number;
}

/** Sloučení výsledků více pravidel: povoleno jen když projdou všechna, čekání je to nejdelší. */
export function mergeOutcomes(outcomes: readonly RateOutcome[]): RateOutcome {
  return {
    allowed: outcomes.every((o) => o.allowed),
    retryAfter: Math.max(0, ...outcomes.map((o) => o.retryAfter)),
  };
}
