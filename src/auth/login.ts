import "server-only";
import { requireEnv } from "@/env";
import { type Locale, localePath } from "@/i18n/config";
import {
  authCreateChallenge,
  authListAdminWeddings,
  authVerifyChallenge,
  rateLimitHit,
} from "@/lib/db/rpc";
import { sendTemplatedEmail } from "@/lib/email/send";
import { renderLoginCode } from "@/lib/email/templates";
import { LOGIN_CODE, RATE_RULES } from "./config";
import { generateCode, seal, unseal } from "./crypto";
import { codeHash, emailHash } from "./identity";
import { rateKey } from "./rate-limit";

/**
 * Přihlášení správce jednorázovým kódem nebo odkazem (docs/security-privacy.md kap. 1.1,
 * ADR 0010). Zásady:
 *  - odpověď na vyžádání kódu je stejná pro známý i neznámý e-mail (stejné volání databáze,
 *    e-mail se posílá až po odpovědi, `defer`), takže nejde zjistit, kdo má účet,
 *  - kód i e-mail jsou v databázi jen jako HMAC, kód platí 10 minut a jde použít jednou,
 *  - odkaz z e-mailu je zapečetěný (e-mail ani kód nejsou čitelné v adrese) a otevře jen
 *    potvrzovací stránku; přihlásí až odeslání formuláře (skener schránky ho nespotřebuje).
 */

const PURPOSE = "admin_login" as const;
const LINK_PURPOSE = "login-link";

export type Defer = (task: () => Promise<unknown>) => void;

/**
 * Odkaz z e-mailu: zapečetěný e-mail a kód (v adrese nejsou čitelné), platí stejně dlouho jako kód.
 * Sdílí ho vyžádání kódu správcem i poslání přihlašovacího odkazu operátorem (M9).
 */
export function loginLinkFor(
  origin: string,
  email: string,
  code: string,
  locale: Locale = "cs",
): string {
  const token = seal(requireEnv("AUTH_SECRET"), LINK_PURPOSE, {
    e: email,
    c: code,
    x: Date.now() + LOGIN_CODE.ttlSeconds * 1000,
  } satisfies LinkPayload);
  // Jazyk rozhraní určuje cesta: e-mail v jiném než výchozím jazyce vede na `/<jazyk>/...`.
  return `${origin}${localePath(`/prihlaseni/odkaz?t=${token}`, locale)}`;
}

export type RequestCodeResult = { status: "sent" } | { status: "limited"; retryAfter: number };

type LinkPayload = { e: string; c: string; x: number };

export async function requestLoginCode(input: {
  email: string;
  ip: string;
  locale: Locale;
  /** Adresa hostitele `app.` pro odkaz v e-mailu (`appOrigin`). */
  origin: string;
  defer: Defer;
}): Promise<RequestCodeResult> {
  const authSecret = requireEnv("AUTH_SECRET");
  const limitSecret = requireEnv("RATE_LIMIT_SECRET");

  // Selhání úložiště omezení = výjimka = přihlášení selže zavřeně (ADR 0010).
  const byIp = await rateLimitHit(
    rateKey(limitSecret, "login-request-ip", input.ip),
    RATE_RULES.loginRequestIp.limit,
    RATE_RULES.loginRequestIp.windowSeconds,
  );
  if (!byIp.allowed) return { status: "limited", retryAfter: byIp.retryAfter };

  // Čítač e-mailu se zvyšuje i pro neznámé adresy; po překročení je odpověď stejná, kód se neposílá.
  const byEmail = await rateLimitHit(
    rateKey(limitSecret, "login-request-email", input.email),
    RATE_RULES.loginRequestEmail.limit,
    RATE_RULES.loginRequestEmail.windowSeconds,
  );

  // zablokovaný web (FR-OPS-2) relaci nevydá: kód se kvůli němu neposílá a neotevře se
  const weddings = (await authListAdminWeddings(input.email)).filter((w) => w.status !== "blocked");

  if (byEmail.allowed) {
    // Výzva vzniká i pro neznámý e-mail (stejná práce); ověřit ji nikdo nemůže, kód nikam nešel.
    const code = generateCode(LOGIN_CODE.length);
    await authCreateChallenge({
      emailHash: emailHash(authSecret, input.email),
      purpose: PURPOSE,
      codeHash: codeHash(authSecret, input.email, code),
      ttlSeconds: LOGIN_CODE.ttlSeconds,
    });

    if (weddings.length > 0) {
      const email = renderLoginCode({
        locale: input.locale,
        code,
        link: loginLinkFor(input.origin, input.email, code, input.locale),
        ttlSeconds: LOGIN_CODE.ttlSeconds,
      });
      input.defer(() =>
        sendTemplatedEmail({
          type: "login_code",
          to: input.email,
          weddingId: null,
          locale: input.locale,
          email,
          secret: authSecret,
        }),
      );
    }
  }

  return { status: "sent" };
}

export type VerifyCodeResult =
  | { status: "ok"; weddingId: string; adminId: string }
  | { status: "invalid" }
  | { status: "limited"; retryAfter: number };

/** Ověří kód (e-mail z rozpracovaného přihlášení nebo z odkazu) a určí svatbu pro relaci. */
export async function verifyLoginCode(input: {
  email: string;
  code: string;
  ip: string;
}): Promise<VerifyCodeResult> {
  const authSecret = requireEnv("AUTH_SECRET");
  const limitSecret = requireEnv("RATE_LIMIT_SECRET");

  const byIp = await rateLimitHit(
    rateKey(limitSecret, "login-verify-ip", input.ip),
    RATE_RULES.loginVerifyIp.limit,
    RATE_RULES.loginVerifyIp.windowSeconds,
  );
  if (!byIp.allowed) return { status: "limited", retryAfter: byIp.retryAfter };

  const valid = await authVerifyChallenge({
    emailHash: emailHash(authSecret, input.email),
    purpose: PURPOSE,
    codeHash: codeHash(authSecret, input.email, input.code),
    maxAttempts: LOGIN_CODE.maxAttempts,
    clientKey: rateKey(limitSecret, "challenge-client", input.ip),
  });
  if (!valid) return { status: "invalid" };

  // Správce více svateb: zatím se otevře nejstarší (výběr svatby přijde se správou, M7).
  const [first] = (await authListAdminWeddings(input.email)).filter((w) => w.status !== "blocked");
  if (!first) return { status: "invalid" };
  return { status: "ok", weddingId: first.weddingId, adminId: first.adminId };
}

/** Obsah odkazu z e-mailu; neplatný, upravený nebo prošlý odkaz je `null`. */
export function openLoginLink(token: string): { email: string; code: string } | null {
  const payload = unseal<LinkPayload>(requireEnv("AUTH_SECRET"), LINK_PURPOSE, token);
  if (
    !payload ||
    typeof payload.e !== "string" ||
    typeof payload.c !== "string" ||
    typeof payload.x !== "number" ||
    payload.x < Date.now()
  ) {
    return null;
  }
  return { email: payload.e, code: payload.c };
}

const PENDING_PURPOSE = "login-pending";

/** Rozpracované přihlášení v prohlížeči, který kód vyžádal (hodnota cookie `sv_login`). */
export function sealPendingLogin(email: string): string {
  return seal(requireEnv("AUTH_SECRET"), PENDING_PURPOSE, {
    e: email,
    x: Date.now() + LOGIN_CODE.ttlSeconds * 1000,
  });
}

export function openPendingLogin(token: string): string | null {
  const payload = unseal<{ e: string; x: number }>(
    requireEnv("AUTH_SECRET"),
    PENDING_PURPOSE,
    token,
  );
  return payload && typeof payload.e === "string" && payload.x > Date.now() ? payload.e : null;
}
