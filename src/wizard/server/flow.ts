import "server-only";
import { requireEnv } from "@/env";
import { RATE_RULES, type RateRule } from "@/auth/config";
import { generateCode, generateToken, hashToken, seal, unseal } from "@/auth/crypto";
import { codeHash, emailHash } from "@/auth/identity";
import { hashPin, verifyPin } from "@/auth/pin";
import { pinProblem } from "@/auth/pin-format";
import { rateKey } from "@/auth/rate-limit";
import { currentHostConfig, siteHostname } from "@/auth/app-origin";
import { backupConfirmUrl } from "@/auth/backup-confirm";
import type { Defer } from "@/auth/login";
import { LOGIN_CODE } from "@/auth/config";
import type { Locale } from "@/i18n/config";
import {
  authCreateChallenge,
  authPinOtherHash,
  authPinSet,
  authVerifyChallenge,
  rateLimitHit,
} from "@/lib/db/rpc";
import {
  analyticsRecord,
  checkSlug,
  publishSite,
  setPreviewToken,
  wizardCreateDraft,
  wizardLoad,
  wizardSave,
  type AnalyticsEvent,
  type WizardSlugStatus,
} from "@/lib/db/rpc-wizard";
import { sendTemplatedEmail } from "@/lib/email/send";
import { renderAdminNotice, renderWizardCode } from "@/lib/email/templates";
import { toPublicContent, toSensitiveContent, toWorkingSet } from "../content";
import {
  canSaveToServer,
  serverDraft,
  validateDraft,
  type Issue,
  type WizardDraft,
} from "../draft";
import { normalizeSlugInput, slugProblem, type SlugProblem } from "../slug";

/**
 * Serverová logika průvodce bez závislosti na Next.js (cookies, hlavičky, přesměrování řeší
 * Server Actions): omezení počtu požadavků, ověření e-mailu kódem, první uložení, průběžné
 * ukládání, zveřejnění, odkaz na náhled a měření. Do logu se nikdy nedostane e-mail, jméno ani IP.
 */

const PURPOSE = "wizard_create" as const;
const PENDING = "wizard-pending";
const VERIFIED = "wizard-verified";

/** Ověřený e-mail platí pro první uložení 30 minut (kolize adresy nevynutí nový kód). */
export const VERIFIED_SECONDS = 30 * 60;

async function limited(
  scope: string,
  value: string,
  rule: RateRule,
): Promise<{ allowed: boolean; retryAfter: number }> {
  return rateLimitHit(
    rateKey(requireEnv("RATE_LIMIT_SECRET"), scope, value),
    rule.limit,
    rule.windowSeconds,
  );
}

// --- zapečetěný stav v cookie ---------------------------------------------------------------

export type WizardEmails = { email: string; backupEmail: string };

type SealedEmails = { e: string; b: string; x: number };

export function sealPending(emails: WizardEmails, now = Date.now()): string {
  const payload: SealedEmails = {
    e: emails.email,
    b: emails.backupEmail,
    x: now + LOGIN_CODE.ttlSeconds * 1000,
  };
  return seal(requireEnv("AUTH_SECRET"), PENDING, payload);
}

export function sealVerified(emails: WizardEmails, now = Date.now()): string {
  const payload: SealedEmails = {
    e: emails.email,
    b: emails.backupEmail,
    x: now + VERIFIED_SECONDS * 1000,
  };
  return seal(requireEnv("AUTH_SECRET"), VERIFIED, payload);
}

function open(token: string, purpose: string, now: number): WizardEmails | null {
  const payload = unseal<SealedEmails>(requireEnv("AUTH_SECRET"), purpose, token);
  if (
    !payload ||
    typeof payload.e !== "string" ||
    typeof payload.b !== "string" ||
    typeof payload.x !== "number" ||
    payload.x < now
  ) {
    return null;
  }
  return { email: payload.e, backupEmail: payload.b };
}

export const openPending = (token: string, now = Date.now()) => open(token, PENDING, now);
export const openVerified = (token: string, now = Date.now()) => open(token, VERIFIED, now);

// --- ověření e-mailu kódem ------------------------------------------------------------------

export type RequestCodeResult = { status: "sent" } | { status: "limited"; retryAfter: number };

/**
 * Pošle kód na e-mail správce. Odpověď je stejná bez ohledu na to, zda e-mail už u nějaké svatby
 * je (kód vzniká vždy). Při překročení limitu e-mailu se kód neposílá a odpověď zůstává stejná.
 */
export async function requestWizardCode(input: {
  email: string;
  ip: string;
  locale: Locale;
  defer: Defer;
}): Promise<RequestCodeResult> {
  const authSecret = requireEnv("AUTH_SECRET");

  const byIp = await limited("wizard-code-ip", input.ip, RATE_RULES.wizardCodeIp);
  if (!byIp.allowed) return { status: "limited", retryAfter: byIp.retryAfter };
  const byEmail = await limited("wizard-code-email", input.email, RATE_RULES.wizardCodeEmail);

  if (byEmail.allowed) {
    const code = generateCode(LOGIN_CODE.length);
    await authCreateChallenge({
      emailHash: emailHash(authSecret, input.email),
      purpose: PURPOSE,
      codeHash: codeHash(authSecret, input.email, code),
      ttlSeconds: LOGIN_CODE.ttlSeconds,
    });
    const email = renderWizardCode({
      locale: input.locale,
      code,
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
  return { status: "sent" };
}

export type VerifyCodeResult = "ok" | "invalid" | { limited: number };

export async function verifyWizardCode(input: {
  email: string;
  code: string;
  ip: string;
}): Promise<VerifyCodeResult> {
  const authSecret = requireEnv("AUTH_SECRET");
  const byIp = await limited("wizard-verify-ip", input.ip, RATE_RULES.wizardVerifyIp);
  if (!byIp.allowed) return { limited: byIp.retryAfter };
  const valid = await authVerifyChallenge({
    emailHash: emailHash(authSecret, input.email),
    purpose: PURPOSE,
    codeHash: codeHash(authSecret, input.email, input.code),
    maxAttempts: LOGIN_CODE.maxAttempts,
    clientKey: rateKey(requireEnv("RATE_LIMIT_SECRET"), "challenge-client", input.ip),
  });
  return valid ? "ok" : "invalid";
}

// --- uložení --------------------------------------------------------------------------------

export type FirstSaveResult =
  | { status: "created"; weddingId: string; adminId: string; slug: string; previewToken: string }
  | { status: "taken"; variants: string[] }
  | { status: "incomplete"; issues: Issue[] }
  | { status: "limited"; retryAfter: number };

/**
 * První uložení: svatba, správce a rezervace adresy v jedné transakci (`wizard_create_draft`).
 * E-mail musí být ověřený kódem (volající to zajišťuje cookie `wizard-verified`). Při kolizi adresy
 * se nic nezaloží a vrátí se varianty; rozepsaná data zůstávají v prohlížeči.
 */
export async function firstSave(input: {
  emails: WizardEmails;
  draft: WizardDraft;
  ip: string;
  /**
   * Záložní adresu nikdo neověřil, takže dostane jedinou neutrální zprávu „někdo vás uvedl jako záložní
   * e-mail“ s odkazem na potvrzení (`origin` = adresa hostitele app); žádná další oznámení na ni
   * nechodí, dokud ji její vlastník nepotvrdí.
   */
  backupNotice?: { locale: Locale; defer: Defer; origin: string };
}): Promise<FirstSaveResult> {
  if (!canSaveToServer(input.draft)) {
    return { status: "incomplete", issues: validateDraft(input.draft) };
  }
  const byIp = await limited("wizard-create-ip", input.ip, RATE_RULES.wizardCreateIp);
  if (!byIp.allowed) return { status: "limited", retryAfter: byIp.retryAfter };

  const result = await wizardCreateDraft({
    email: input.emails.email,
    backupEmail: input.emails.backupEmail,
    slug: input.draft.slug,
    draft: serverDraft(input.draft),
    work: toWorkingSet(input.draft),
  });
  if (!result.ok) return { status: "taken", variants: result.variants };

  const previewToken = generateToken();
  await setPreviewToken(result.weddingId, hashToken(previewToken), result.adminId);

  if (input.backupNotice) {
    const { locale, defer, origin } = input.backupNotice;
    const secret = requireEnv("AUTH_SECRET");
    const email = renderAdminNotice({
      locale,
      kind: "backup_added",
      at: new Date(),
      site: siteHostname(input.draft.slug, currentHostConfig()),
      confirmUrl: backupConfirmUrl(origin, locale, result.weddingId, input.emails.backupEmail),
    });
    defer(() =>
      sendTemplatedEmail({
        type: "admin_changed",
        to: input.emails.backupEmail,
        weddingId: result.weddingId,
        locale,
        email,
        secret,
      }),
    );
  }
  return {
    status: "created",
    weddingId: result.weddingId,
    adminId: result.adminId,
    slug: input.draft.slug,
    previewToken,
  };
}

export type UpdateSaveResult =
  | {
      status: "saved";
      slug: string | null;
      slugStatus: WizardSlugStatus;
      variants: string[];
      reservedUntil: string | null;
    }
  | { status: "not_draft" }
  | { status: "incomplete"; issues: Issue[] }
  | { status: "limited"; retryAfter: number };

/** Průběžné ukládání rozpracovaného konceptu přihlášeného správce (kolize adresy data neohrozí). */
export async function updateSave(input: {
  weddingId: string;
  draft: WizardDraft;
}): Promise<UpdateSaveResult> {
  if (!canSaveToServer(input.draft)) {
    return { status: "incomplete", issues: validateDraft(input.draft) };
  }
  const byWedding = await limited(
    "wizard-save-wedding",
    input.weddingId,
    RATE_RULES.wizardSaveWedding,
  );
  if (!byWedding.allowed) return { status: "limited", retryAfter: byWedding.retryAfter };

  const state = await wizardLoad(input.weddingId);
  if (!state || state.status !== "draft") return { status: "not_draft" };

  const saved = await wizardSave({
    weddingId: input.weddingId,
    slug: input.draft.slug,
    draft: serverDraft(input.draft),
    work: toWorkingSet(input.draft),
  });
  return {
    status: "saved",
    slug: saved.slug,
    slugStatus: saved.slugStatus,
    variants: saved.variants,
    reservedUntil: saved.reservedUntil?.toISOString() ?? null,
  };
}

/** Nový odkaz na náhled: starý přestane platit. Token se vrací jen volajícímu, v databázi je hash. */
export async function renewPreviewToken(input: {
  weddingId: string;
  adminId: string;
}): Promise<string> {
  const token = generateToken();
  await setPreviewToken(input.weddingId, hashToken(token), input.adminId);
  return token;
}

// --- zveřejnění -----------------------------------------------------------------------------

export type PublishResult =
  | { status: "published"; slug: string; versionNo: number }
  | { status: "invalid"; issues: Issue[] }
  | { status: "slug_unavailable"; variants: string[]; slugStatus: WizardSlugStatus }
  | { status: "not_draft" }
  | { status: "limited"; retryAfter: number };

/**
 * Zveřejnění: uloží poslední stav, ověří úplnost a paletu (`validateDraft` včetně
 * `validatePalette`), nastaví hash PINu hostů a vloží verzi webu (`publish_site`). Snímek se skládá
 * stejnou funkcí jako náhled a prochází `publicContentSchema`. Adresa po zveřejnění zůstává trvale
 * přidělená.
 */
export async function publish(input: {
  weddingId: string;
  adminId: string;
  draft: WizardDraft;
}): Promise<PublishResult> {
  const issues = validateDraft(input.draft);
  if (issues.length > 0) return { status: "invalid", issues };

  const saved = await updateSave({ weddingId: input.weddingId, draft: input.draft });
  if (saved.status === "limited") return saved;
  if (saved.status !== "saved") {
    return saved.status === "not_draft" ? { status: "not_draft" } : { status: "invalid", issues };
  }
  if (saved.slugStatus !== "ok" || saved.slug === null) {
    return { status: "slug_unavailable", variants: saved.variants, slugStatus: saved.slugStatus };
  }

  if (input.draft.guestPin.enabled) {
    const pepper = requireEnv("PIN_PEPPER");
    const pin = input.draft.guestPin.pin;
    if (pinProblem(pin) !== null) return { status: "invalid", issues };
    // PIN hostů a PIN správy nesmějí být shodné (správa má PIN až později, kontrola je pojistka).
    const other = await authPinOtherHash(input.weddingId, "guest");
    if (other && (await verifyPin(other, pin, pepper))) return { status: "invalid", issues };
    await authPinSet({
      weddingId: input.weddingId,
      role: "guest",
      hash: await hashPin(pin, pepper),
      actorAdminId: input.adminId,
    });
  }

  const content = toPublicContent(input.draft, { slug: saved.slug });
  const result = await publishSite({
    weddingId: input.weddingId,
    actorAdminId: input.adminId,
    publicContent: content,
    sensitive: toSensitiveContent(),
  });

  await recordEvent({
    event: "site_published",
    locale: input.draft.defaultLocale,
    template: input.draft.template,
  });
  return { status: "published", slug: result.slug, versionNo: result.versionNo };
}

// --- adresa: živá kontrola ------------------------------------------------------------------

export type SlugCheckResult =
  | { status: "available"; slug: string }
  | { status: "unavailable"; slug: string }
  | { status: "invalid"; slug: string; problem: SlugProblem }
  | { status: "limited"; retryAfter: number };

/**
 * Informativní kontrola dostupnosti adresy při psaní. Jen jedna adresa na dotaz, omezení počtu
 * dotazů podle IP přímo v databázi, a zabraná, rezervovaná i blokovaná adresa mají stejnou
 * odpověď (`unavailable`): nejde zjistit, které adresy existují. Skutečnou rezervaci rozhoduje
 * až první uložení.
 */
export async function checkSlugAvailability(rawSlug: string, ip: string): Promise<SlugCheckResult> {
  const slug = normalizeSlugInput(rawSlug);
  const problem = slugProblem(slug);
  if (problem === "reserved") return { status: "unavailable", slug };
  if (problem) return { status: "invalid", slug, problem };

  const rule = RATE_RULES.slugCheckIp;
  const result = await checkSlug(slug, {
    key: rateKey(requireEnv("RATE_LIMIT_SECRET"), "slug-check-ip", ip),
    limit: rule.limit,
    windowSeconds: rule.windowSeconds,
  });
  if (result.reason === "rate_limited") return { status: "limited", retryAfter: result.retryAfter };
  if (result.reason === "invalid") return { status: "invalid", slug, problem: "format" };
  return { status: result.available ? "available" : "unavailable", slug };
}

// --- měření ---------------------------------------------------------------------------------

export const WIZARD_EVENTS = ["wizard_started", "wizard_step_completed"] as const;

/** Měřicí událost do uzavřeného seznamu; chyba měření nikdy neshodí průvodce ani nic nelogují. */
export async function recordEvent(input: {
  event: AnalyticsEvent;
  locale: Locale;
  template?: string | null;
  step?: number | null;
}): Promise<void> {
  try {
    await analyticsRecord(input);
  } catch {
    console.error("[měření] událost se nepodařilo zapsat");
  }
}

/** Událost z prohlížeče: omezení podle IP, tiché zahození při překročení. */
export async function trackFromBrowser(input: {
  event: (typeof WIZARD_EVENTS)[number];
  locale: Locale;
  template: string | null;
  step: number | null;
  ip: string;
}): Promise<void> {
  const byIp = await limited("wizard-event-ip", input.ip, RATE_RULES.wizardEventIp);
  if (!byIp.allowed) return;
  await recordEvent(input);
}
