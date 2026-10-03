import "server-only";
import { after } from "next/server";
import { requireEnv } from "@/env";
import { RATE_RULES } from "@/auth/config";
import { generateToken, hashToken } from "@/auth/crypto";
import { rateKey } from "@/auth/rate-limit";
import { localizedPath } from "@/i18n/pathnames";
import { rateLimitHit } from "@/lib/db/rpc";
import { waitlistAdd } from "@/lib/db/rpc-wizard";
import { sendTemplatedEmail } from "@/lib/email/send";
import { renderWaitlistConfirm } from "@/lib/email/templates";
import { siteUrl } from "@/lib/site";
import type { RateLimiter, WaitlistDeps, WaitlistEntry, WaitlistStore } from "./waitlist";

/**
 * Adaptéry čekací listiny nad databází (service role, funkce `waitlist_add` a `rate_limit_hit`).
 * Klíč omezení je HMAC (v databázi není IP adresa), e-mail se normalizuje ve schématu i v databázi.
 *
 * Double opt-in: zápis nese otisk jednorázového tokenu a adresa platí až po potvrzení odkazem z e-mailu
 * (`/cekaci-listina/potvrzeni?t=…`). E-mail se posílá po odpovědi (`after`), odpověď formuláře je vždy stejná,
 * takže nic neprozradí, zda adresa už na listině je.
 */

type Defer = (task: () => Promise<unknown>) => void;

const deferAfter: Defer = (task) =>
  after(async () => {
    await task();
  });

/** Odkaz pro potvrzení (stránka s tlačítkem na hostiteli úvodní stránky). */
export function waitlistConfirmLink(entry: Pick<WaitlistEntry, "locale">, token: string): string {
  const url = new URL(localizedPath("waitlistConfirm", entry.locale), siteUrl);
  url.searchParams.set("t", token);
  return url.toString();
}

export function createWaitlistStore(defer: Defer = deferAfter): WaitlistStore {
  return {
    async add(entry) {
      const token = generateToken();
      const send = await waitlistAdd(
        entry.email,
        entry.locale,
        entry.consentTextVersion,
        hashToken(token),
      );
      if (send) {
        defer(() =>
          sendTemplatedEmail({
            type: "waitlist_confirm",
            to: entry.email,
            weddingId: null,
            locale: entry.locale,
            email: renderWaitlistConfirm({
              locale: entry.locale,
              link: waitlistConfirmLink(entry, token),
            }),
            secret: requireEnv("AUTH_SECRET"),
          }),
        );
      }
      return { created: send };
    },
  };
}

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

export function dbWaitlistDeps(defer?: Defer): WaitlistDeps {
  return { store: createWaitlistStore(defer), rateLimiter: dbRateLimiter };
}
