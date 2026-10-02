import "server-only";
import { requireEnv } from "@/env";
import { generateCode } from "@/auth/crypto";
import { codeHash, emailHash } from "@/auth/identity";
import { loginLinkFor, type Defer } from "@/auth/login";
import { rateKey } from "@/auth/rate-limit";
import type { Locale } from "@/i18n/config";
import { rateLimitHit } from "@/lib/db/rpc";
import { opSendLoginLink } from "@/lib/db/rpc-ops";
import { sendTemplatedEmail } from "@/lib/email/send";
import { renderLoginCode } from "@/lib/email/templates";
import { LOGIN_LINK_TTL_SECONDS, OPERATOR_RATE_RULES } from "./config";
import type { OperatorSession } from "./session";

export type LoginLinkResult = { status: "sent" } | { status: "limited" } | { status: "failed" };

/**
 * Pošle správci zakázky jednorázový kód a odkaz (FR-OPS-4). Databáze v téže transakci vytvoří výzvu
 * (HMAC kódu a e-mailu spočítaný zde) a zapíše audit; e-mail jde po odpovědi. Odkaz správce nepřihlásí sám
 * (potvrzovací stránka), takže ho nespotřebuje ani skener schránky. Omezeno podle správce i operátora.
 */
export async function sendAdminLoginLink(input: {
  operator: OperatorSession;
  weddingId: string;
  adminId: string;
  /** E-mail správce z detailu zakázky; databáze ho při volání ověří. */
  adminEmail: string;
  locale: Locale;
  origin: string;
  defer: Defer;
}): Promise<LoginLinkResult> {
  const authSecret = requireEnv("AUTH_SECRET");
  const limitSecret = requireEnv("RATE_LIMIT_SECRET");

  const byAdmin = await rateLimitHit(
    rateKey(limitSecret, "op-link-admin", input.adminId),
    OPERATOR_RATE_RULES.loginLinkAdmin.limit,
    OPERATOR_RATE_RULES.loginLinkAdmin.windowSeconds,
  );
  const byOperator = await rateLimitHit(
    rateKey(limitSecret, "op-link-operator", input.operator.operatorId),
    OPERATOR_RATE_RULES.loginLinkOperator.limit,
    OPERATOR_RATE_RULES.loginLinkOperator.windowSeconds,
  );
  if (!byAdmin.allowed || !byOperator.allowed) return { status: "limited" };

  const email = input.adminEmail.trim().toLowerCase();
  const code = generateCode(6);
  const returned = await opSendLoginLink({
    operatorId: input.operator.operatorId,
    weddingId: input.weddingId,
    adminId: input.adminId,
    emailHash: emailHash(authSecret, email),
    codeHash: codeHash(authSecret, email, code),
    ttlSeconds: LOGIN_LINK_TTL_SECONDS,
  });
  // E-mail správce se mezitím změnil: výzva by patřila jiné adrese, kód se neposílá.
  if (returned.trim().toLowerCase() !== email) return { status: "failed" };

  const message = renderLoginCode({
    locale: input.locale,
    code,
    link: loginLinkFor(input.origin, email, code),
    ttlSeconds: LOGIN_LINK_TTL_SECONDS,
  });
  input.defer(() =>
    sendTemplatedEmail({
      type: "login_code",
      to: email,
      weddingId: input.weddingId,
      locale: input.locale,
      email: message,
      secret: authSecret,
    }),
  );
  return { status: "sent" };
}
