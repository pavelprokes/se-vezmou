import "server-only";
import { requireEnv } from "@/env";
import { RATE_RULES } from "@/auth/config";
import { rateKey } from "@/auth/rate-limit";
import { rateLimitHit } from "@/lib/db/rpc";
import { waitlistAdd } from "@/lib/db/rpc-wizard";
import type { RateLimiter, WaitlistDeps, WaitlistStore } from "./waitlist";

/**
 * Adaptéry čekací listiny nad databází (service role, funkce `waitlist_add` a `rate_limit_hit`).
 * Klíč omezení je HMAC (v databázi není IP adresa), e-mail se normalizuje ve schématu i v databázi.
 */

export const dbWaitlistStore: WaitlistStore = {
  async add(entry) {
    const created = await waitlistAdd(entry.email, entry.locale, entry.consentTextVersion);
    return { created };
  },
};

export const dbRateLimiter: RateLimiter = {
  async check(key) {
    const rule = RATE_RULES.waitlistIp;
    const result = await rateLimitHit(
      rateKey(requireEnv("RATE_LIMIT_SECRET"), "waitlist-ip", key),
      rule.limit,
      rule.windowSeconds,
    );
    return { allowed: result.allowed };
  },
};

export function dbWaitlistDeps(): WaitlistDeps {
  return { store: dbWaitlistStore, rateLimiter: dbRateLimiter };
}
