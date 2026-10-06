import "server-only";
import { RATE_RULES } from "@/auth/config";
import { rateKey } from "@/auth/rate-limit";
import { env, requireEnv } from "@/env";
import { rateLimitHit } from "@/lib/db/rpc";
import { sendTemplatedEmail } from "@/lib/email/send";
import { renderOperatorSitePublished } from "@/lib/email/templates";
import type { Locale } from "@/i18n/config";

/**
 * Upozornění provozovateli, že někdo dokončil průvodce (zveřejnil web). Best effort: bez
 * `OPERATOR_NOTIFY_EMAIL` se nic neposílá a žádná chyba nesmí zvrátit zveřejnění. Zpráva nese jen
 * veřejné údaje (adresa, šablona, jazyk), nikdy jména, e-maily ani PIN. Do logu jde jen název chyby.
 */
export async function notifyOperatorSitePublished(input: {
  weddingId: string;
  slug: string;
  siteUrl: string;
  template: string;
  locale: Locale;
  now?: Date;
}): Promise<void> {
  try {
    const to = env.OPERATOR_NOTIFY_EMAIL;
    if (!to) return;
    try {
      const rule = RATE_RULES.operatorSitePublished;
      const hit = await rateLimitHit(
        rateKey(requireEnv("RATE_LIMIT_SECRET"), "operator-site-published", "all"),
        rule.limit,
        rule.windowSeconds,
      );
      if (!hit.allowed) return;
    } catch (error) {
      console.error("[průvodce] počítadlo omezení selhalo, pokračuji", errorName(error));
    }
    await sendTemplatedEmail({
      type: "operator_notice",
      to,
      weddingId: input.weddingId,
      locale: "cs",
      email: renderOperatorSitePublished({
        siteUrl: input.siteUrl,
        slug: input.slug,
        template: input.template,
        locale: input.locale,
        at: input.now ?? new Date(),
      }),
      secret: requireEnv("AUTH_SECRET"),
    });
  } catch (error) {
    console.error("[průvodce] upozornění provozovateli selhalo", errorName(error));
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}
