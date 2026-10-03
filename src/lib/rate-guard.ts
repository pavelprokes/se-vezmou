import "server-only";
import type { RateRule } from "@/auth/config";
import { rateKey } from "@/auth/rate-limit";
import { requireEnv } from "@/env";
import { rateLimitHit } from "@/lib/db/rpc";
import { DbError } from "@/lib/db/transport";

/**
 * Společné pomocné funkce serverové logiky správy (web, hosté, přístup, fotografie): omezení počtu požadavků
 * podle svatby a identifikátor chyby databáze. Selhání úložiště omezení je výjimka, takže akce selže zavřeně
 * (ADR 0010).
 */

/** `null`, když je volání povoleno; jinak počet sekund do dalšího pokusu. */
export async function limited(
  scope: string,
  weddingId: string,
  rule: RateRule,
): Promise<number | null> {
  const result = await rateLimitHit(
    rateKey(requireEnv("RATE_LIMIT_SECRET"), scope, weddingId),
    rule.limit,
    rule.windowSeconds,
  );
  return result.allowed ? null : result.retryAfter;
}

/** Identifikátor hlášení funkce databáze (`site_not_editable`), nebo `undefined` u jiné chyby. */
export function reasonOf(error: unknown): string | undefined {
  return error instanceof DbError ? error.reason : undefined;
}
