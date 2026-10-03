import "server-only";
import { defaultLocale } from "@/i18n/config";
import { requireEnv } from "@/env";
import { seal, unseal, generateCode } from "@/auth/crypto";
import { codeHash, emailHash } from "@/auth/identity";
import type { Defer } from "@/auth/login";
import { rateKey } from "@/auth/rate-limit";
import {
  authCreateChallenge,
  authVerifyChallenge,
  lockoutAttempt,
  lockoutReset,
  rateLimitHit,
} from "@/lib/db/rpc";
import {
  authOperatorFind,
  authOperatorMfaAccept,
  authOperatorTotpStep,
  authOperatorMfaBegin,
  authOperatorMfaConfirm,
  authOperatorMfaGet,
  authOperatorRegenerateBackupCodes,
  authOperatorUseBackupCode,
} from "@/lib/db/rpc-ops";
import { sendTemplatedEmail } from "@/lib/email/send";
import {
  renderOperatorCode,
  renderOperatorNotice,
  type OperatorNoticeParams,
} from "@/lib/email/templates";
import {
  OPERATOR_CODE,
  OPERATOR_MFA_LOCKOUT,
  OPERATOR_PENDING_SECONDS,
  OPERATOR_RATE_RULES,
  TOTP_ISSUER,
} from "./config";
import { generateBackupCodes, hashBackupCode, normalizeBackupCode } from "./backup-codes";
import { decryptTotpSecret, encryptTotpSecret } from "./mfa-secret";
import type { OperatorSession } from "./session";
import { generateTotpSecret, otpauthUri, parseTotpCode, verifyTotp } from "./totp";

/**
 * Přihlášení operátora bez Supabase Auth (docs/adr/0012):
 *  1. e-mail -> jednorázový kód (výzva `operator_login`, 10 minut, jednou, pět pokusů) -> relace AAL1,
 *  2. povinný druhý faktor: kód TOTP (RFC 6238) nebo záložní kód -> AAL2,
 *  3. první přihlášení: zápis druhého faktoru (klíč se ukáže, operátor potvrdí kódem z aplikace
 *     a dostane záložní kódy, které se ukážou jednou).
 * Zásady jako u správců: odpověď na vyžádání kódu je stejná pro známý i neznámý e-mail (stejná práce,
 * e-mail se posílá až po odpovědi), v databázi jsou jen HMAC, a omezení počtu požadavků selže zavřeně.
 */

const PURPOSE = "operator_login" as const;
const PENDING_PURPOSE = "operator-login-pending";

export type RequestOperatorCodeResult =
  { status: "sent" } | { status: "limited"; retryAfter: number };

export async function requestOperatorCode(input: {
  email: string;
  ip: string;
  defer: Defer;
}): Promise<RequestOperatorCodeResult> {
  const authSecret = requireEnv("AUTH_SECRET");
  const limitSecret = requireEnv("RATE_LIMIT_SECRET");

  const byIp = await rateLimitHit(
    rateKey(limitSecret, "op-code-ip", input.ip),
    OPERATOR_RATE_RULES.codeRequestIp.limit,
    OPERATOR_RATE_RULES.codeRequestIp.windowSeconds,
  );
  if (!byIp.allowed) return { status: "limited", retryAfter: byIp.retryAfter };

  // Čítač e-mailu se zvyšuje i pro neznámé adresy; po překročení je odpověď stejná, kód se neposílá.
  const byEmail = await rateLimitHit(
    rateKey(limitSecret, "op-code-email", input.email),
    OPERATOR_RATE_RULES.codeRequestEmail.limit,
    OPERATOR_RATE_RULES.codeRequestEmail.windowSeconds,
  );

  const operator = await authOperatorFind(input.email);

  if (byEmail.allowed) {
    // Výzva vzniká i pro neznámý e-mail (stejná práce); kód nikam nejde, takže ji nikdo neověří.
    const code = generateCode(OPERATOR_CODE.length);
    await authCreateChallenge({
      emailHash: emailHash(authSecret, input.email),
      purpose: PURPOSE,
      codeHash: codeHash(authSecret, input.email, code),
      ttlSeconds: OPERATOR_CODE.ttlSeconds,
    });
    if (operator) {
      const email = renderOperatorCode({ code, ttlSeconds: OPERATOR_CODE.ttlSeconds });
      input.defer(() =>
        sendTemplatedEmail({
          type: "login_code",
          to: input.email,
          weddingId: null,
          // Šablony e-mailů operátorům jsou jen ve výchozím jazyce.
          locale: defaultLocale,
          email,
          secret: authSecret,
        }),
      );
    }
  }
  return { status: "sent" };
}

export type VerifyOperatorCodeResult =
  | { status: "ok"; operatorId: string; totpConfirmed: boolean }
  | { status: "invalid" }
  | { status: "limited"; retryAfter: number };

/** Ověří kód z e-mailu. Neznámý, zakázaný nebo mezitím odebraný operátor je stejné `invalid` jako chybný kód. */
export async function verifyOperatorCode(input: {
  email: string;
  code: string;
  ip: string;
}): Promise<VerifyOperatorCodeResult> {
  const authSecret = requireEnv("AUTH_SECRET");
  const limitSecret = requireEnv("RATE_LIMIT_SECRET");

  const byIp = await rateLimitHit(
    rateKey(limitSecret, "op-code-verify-ip", input.ip),
    OPERATOR_RATE_RULES.codeVerifyIp.limit,
    OPERATOR_RATE_RULES.codeVerifyIp.windowSeconds,
  );
  if (!byIp.allowed) return { status: "limited", retryAfter: byIp.retryAfter };

  const valid = await authVerifyChallenge({
    emailHash: emailHash(authSecret, input.email),
    purpose: PURPOSE,
    codeHash: codeHash(authSecret, input.email, input.code),
    maxAttempts: OPERATOR_CODE.maxAttempts,
    clientKey: rateKey(limitSecret, "challenge-client", input.ip),
  });
  if (!valid) return { status: "invalid" };

  const operator = await authOperatorFind(input.email);
  if (!operator) return { status: "invalid" };
  return { status: "ok", operatorId: operator.operatorId, totpConfirmed: operator.totpConfirmed };
}

/** Rozepsané přihlášení v prohlížeči, který kód vyžádal (hodnota cookie `sv_operator_login`). */
export function sealOperatorPending(email: string): string {
  return seal(requireEnv("AUTH_SECRET"), PENDING_PURPOSE, {
    e: email,
    x: Date.now() + OPERATOR_PENDING_SECONDS * 1000,
  });
}

export function openOperatorPending(token: string): string | null {
  const payload = unseal<{ e: string; x: number }>(
    requireEnv("AUTH_SECRET"),
    PENDING_PURPOSE,
    token,
  );
  return payload && typeof payload.e === "string" && payload.x > Date.now() ? payload.e : null;
}

// --- druhý faktor --------------------------------------------------------------------------

function deferNotice(defer: Defer, session: OperatorSession, params: OperatorNoticeParams): void {
  const authSecret = requireEnv("AUTH_SECRET");
  const email = renderOperatorNotice(params);
  defer(() =>
    sendTemplatedEmail({
      type: "operator_notice",
      to: session.email,
      weddingId: null,
      locale: defaultLocale,
      email,
      secret: authSecret,
    }),
  );
}

export type SecondFactorResult =
  | { status: "ok"; usedBackupCode: boolean }
  | { status: "format" }
  | { status: "invalid" }
  | { status: "locked"; retryAfter: number }
  | { status: "limited"; retryAfter: number };

type Blocked = { status: "limited" | "locked"; retryAfter: number };

type FactorGate =
  | { open: true; lockKey: string; newlyLocked: boolean; retryAfter: number }
  | { open: false; result: Blocked };

/** Omezení počtu pokusů o druhý faktor: podle IP a pauza podle operátora (série chyb se zdvojnásobuje). */
async function factorGate(session: OperatorSession, ip: string): Promise<FactorGate> {
  const limitSecret = requireEnv("RATE_LIMIT_SECRET");
  const byIp = await rateLimitHit(
    rateKey(limitSecret, "op-mfa-ip", ip),
    OPERATOR_RATE_RULES.mfaIp.limit,
    OPERATOR_RATE_RULES.mfaIp.windowSeconds,
  );
  if (!byIp.allowed) {
    return { open: false, result: { status: "limited", retryAfter: byIp.retryAfter } };
  }
  const lockKey = rateKey(limitSecret, "op-mfa-operator", session.operatorId);
  // Pokus se započítá před ověřením (souběžné pokusy pauzu neobejdou), úspěch čítač vynuluje.
  const attempt = await lockoutAttempt(lockKey, OPERATOR_MFA_LOCKOUT);
  if (attempt.blocked) {
    return { open: false, result: { status: "locked", retryAfter: attempt.retryAfter } };
  }
  return { open: true, lockKey, newlyLocked: attempt.newlyLocked, retryAfter: attempt.retryAfter };
}

/** Neúspěšný pokus (už započítaný v `factorGate`): pauza, pokud ji tento pokus zahájil. */
function registerFailure(
  gate: Extract<FactorGate, { open: true }>,
): Blocked | { status: "invalid" } {
  return gate.newlyLocked
    ? { status: "locked", retryAfter: gate.retryAfter }
    : { status: "invalid" };
}

/**
 * Přihlášení druhým faktorem. Jedno pole přijme kód z aplikace (6 číslic) i záložní kód (10 znaků),
 * podle tvaru se pozná, o který jde. Každý kód TOTP jde použít jednou (časový krok se eviduje).
 */
export async function verifySecondFactor(input: {
  session: OperatorSession;
  value: unknown;
  ip: string;
  defer: Defer;
  now?: number;
}): Promise<SecondFactorResult> {
  const key = requireEnv("OPERATOR_MFA_KEY");
  // Špatný tvar se nepočítá jako pokus (nic se neověřuje)
  const totp = parseTotpCode(input.value);
  const backup = totp ? null : normalizeBackupCode(input.value);
  if (!totp && !backup) return { status: "format" };

  const gate = await factorGate(input.session, input.ip);
  if (!gate.open) return gate.result;

  const mfa = await authOperatorMfaGet(input.session.operatorId);
  if (!mfa || !mfa.confirmed || !mfa.secretEnc) return registerFailure(gate);

  if (totp) {
    const secret = decryptTotpSecret(key, input.session.operatorId, mfa.secretEnc);
    if (!secret) {
      throw new Error("Tajný klíč TOTP nejde dešifrovat (změnil se OPERATOR_MFA_KEY?)");
    }
    const step = verifyTotp(secret, totp, input.now ?? Date.now(), mfa.lastStep);
    const accepted =
      step !== null &&
      (await authOperatorMfaAccept({
        operatorId: input.session.operatorId,
        sessionId: input.session.sessionId,
        step,
      }));
    if (!accepted) return registerFailure(gate);
    await lockoutReset(gate.lockKey);
    deferNotice(input.defer, input.session, { event: "login", at: new Date() });
    return { status: "ok", usedBackupCode: false };
  }

  const remaining = await authOperatorUseBackupCode({
    operatorId: input.session.operatorId,
    sessionId: input.session.sessionId,
    codeHash: hashBackupCode(key, input.session.operatorId, backup as string),
  });
  if (remaining < 0) return registerFailure(gate);
  await lockoutReset(gate.lockKey);
  deferNotice(input.defer, input.session, { event: "backup_code", at: new Date(), remaining });
  return { status: "ok", usedBackupCode: true };
}

// --- zápis druhého faktoru -----------------------------------------------------------------

export type Enrollment = { secret: string; uri: string };

/**
 * Klíč pro zápis druhého faktoru. První otevření ho vygeneruje a uloží zašifrovaný, další otevření ukáže
 * tentýž, dokud ho operátor nepotvrdí kódem. Potvrzený faktor se tudy nezobrazí (`null`).
 */
export async function loadEnrollment(session: OperatorSession): Promise<Enrollment | null> {
  const key = requireEnv("OPERATOR_MFA_KEY");
  const mfa = await authOperatorMfaGet(session.operatorId);
  if (!mfa || mfa.confirmed) return null;

  let encrypted = mfa.secretEnc;
  if (!encrypted) {
    encrypted = await authOperatorMfaBegin(
      session.operatorId,
      encryptTotpSecret(key, session.operatorId, generateTotpSecret()),
    );
  }
  const secret = decryptTotpSecret(key, session.operatorId, encrypted);
  if (!secret) throw new Error("Tajný klíč TOTP nejde dešifrovat (změnil se OPERATOR_MFA_KEY?)");
  return {
    secret,
    uri: otpauthUri({ issuer: TOTP_ISSUER, account: session.email, secret }),
  };
}

export type ConfirmEnrollmentResult =
  | { status: "ok"; backupCodes: string[] }
  | { status: "format" }
  | { status: "invalid" }
  | { status: "locked"; retryAfter: number }
  | { status: "limited"; retryAfter: number };

/** Potvrdí zápis kódem z aplikace; při úspěchu uloží záložní kódy (jen HMAC) a vrátí je k jednorázovému zobrazení. */
export async function confirmEnrollment(input: {
  session: OperatorSession;
  value: unknown;
  ip: string;
  defer: Defer;
  now?: number;
}): Promise<ConfirmEnrollmentResult> {
  const key = requireEnv("OPERATOR_MFA_KEY");
  const code = parseTotpCode(input.value);
  if (!code) return { status: "format" };

  const gate = await factorGate(input.session, input.ip);
  if (!gate.open) return gate.result;

  const mfa = await authOperatorMfaGet(input.session.operatorId);
  if (!mfa || mfa.confirmed || !mfa.secretEnc) return { status: "invalid" };
  const secret = decryptTotpSecret(key, input.session.operatorId, mfa.secretEnc);
  if (!secret) throw new Error("Tajný klíč TOTP nejde dešifrovat (změnil se OPERATOR_MFA_KEY?)");

  const step = verifyTotp(secret, code, input.now ?? Date.now(), null);
  if (step === null) return registerFailure(gate);

  const codes = generateBackupCodes();
  const confirmed = await authOperatorMfaConfirm({
    operatorId: input.session.operatorId,
    sessionId: input.session.sessionId,
    step,
    backupHashes: codes.map((c) =>
      hashBackupCode(key, input.session.operatorId, normalizeBackupCode(c) as string),
    ),
  });
  if (!confirmed) return { status: "invalid" };
  await lockoutReset(gate.lockKey);
  deferNotice(input.defer, input.session, { event: "login", at: new Date() });
  return { status: "ok", backupCodes: codes };
}

/** Nová sada záložních kódů pro přihlášeného operátora (AAL2); stará se zneplatní, oznámí se e-mailem. */
export type RegenerateCodesResult =
  | { status: "ok"; backupCodes: string[] }
  | { status: "format" }
  | { status: "invalid" }
  | { status: "locked"; retryAfter: number }
  | { status: "limited"; retryAfter: number };

/**
 * Nová sada záložních kódů jen s aktuálním kódem z aplikace (ne záložním kódem): záložní kódy jsou trvalý druhý
 * faktor, a tak je nesmí vytvořit jen převzatá nebo opuštěná relace. Kód se počítá do stejné pauzy jako přihlášení
 * druhým faktorem a jde použít jednou (časový krok se eviduje).
 */
export async function regenerateBackupCodes(input: {
  session: OperatorSession;
  value: unknown;
  ip: string;
  defer: Defer;
  now?: number;
}): Promise<RegenerateCodesResult> {
  const key = requireEnv("OPERATOR_MFA_KEY");
  const code = parseTotpCode(input.value);
  if (!code) return { status: "format" };

  const gate = await factorGate(input.session, input.ip);
  if (!gate.open) return gate.result;

  const mfa = await authOperatorMfaGet(input.session.operatorId);
  if (!mfa || !mfa.confirmed || !mfa.secretEnc) return registerFailure(gate);
  const secret = decryptTotpSecret(key, input.session.operatorId, mfa.secretEnc);
  if (!secret) throw new Error("Tajný klíč TOTP nejde dešifrovat (změnil se OPERATOR_MFA_KEY?)");
  const step = verifyTotp(secret, code, input.now ?? Date.now(), mfa.lastStep);
  const accepted =
    step !== null &&
    (await authOperatorTotpStep({
      operatorId: input.session.operatorId,
      sessionId: input.session.sessionId,
      step,
    }));
  if (!accepted) return registerFailure(gate);
  await lockoutReset(gate.lockKey);

  const codes = generateBackupCodes();
  await authOperatorRegenerateBackupCodes(
    input.session.operatorId,
    codes.map((c) =>
      hashBackupCode(key, input.session.operatorId, normalizeBackupCode(c) as string),
    ),
  );
  deferNotice(input.defer, input.session, {
    event: "backup_codes_regenerated",
    at: new Date(),
  });
  return { status: "ok", backupCodes: codes };
}
