"use server";

import { toLocale } from "@/i18n/config";
import { cookies } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { currentHostConfig } from "@/auth/app-origin";
import { LOGIN_CODE } from "@/auth/config";
import { cookieSpec, expiredCookieSpec } from "@/auth/cookie";
import { normalizeEmail, parseCode } from "@/auth/identity";
import type { Defer } from "@/auth/login";
import { assertSameOrigin, getClientIp, getHost, getUiLocale } from "@/auth/request";
import { getSession, startAdminSession } from "@/auth/session";
import { parseDraft, type Issue, type WizardDraft } from "@/wizard/draft";
import {
  checkSlugAvailability,
  firstSave,
  openPending,
  openVerified,
  publish,
  renewPreviewToken,
  requestWizardCode,
  sealPending,
  sealVerified,
  trackFromBrowser,
  updateSave,
  verifyWizardCode,
  VERIFIED_SECONDS,
  type SlugCheckResult,
} from "@/wizard/server/flow";
import { geocodeAddress, type GeocodeResult } from "@/site/map/server";
import { previewUrl, siteUrl, displayHost } from "@/wizard/urls";
import { authSessionContext } from "@/lib/db/rpc";
import type { WizardSlugStatus } from "@/lib/db/rpc-wizard";

/**
 * Server Actions průvodce. Každá začíná kontrolou původu (CSRF, docs/security-privacy.md kap. 2)
 * a sama si ověřuje, co potřebuje: proxy není bezpečnostní hranice. Vstup prochází zodem,
 * odpovědi nikdy neprozradí, zda e-mail nebo adresa už někde existují (kromě informativní
 * kontroly dostupnosti adresy, která je omezená a nerozlišuje důvod). Do logu se nedostane
 * e-mail, jméno, PIN ani IP.
 *
 * Autoritativní stav (přihlášená svatba) se vždy bere z relace, nikdy z argumentu od klienta.
 */

const defer: Defer = (task) =>
  after(async () => {
    await task();
  });

async function originAllowed(): Promise<boolean> {
  try {
    await assertSameOrigin();
    return true;
  } catch {
    return false;
  }
}

function logFailure(action: string, error: unknown): void {
  // Jen název akce a typ chyby: argumenty nesou osobní údaje.
  console.error(`[průvodce] ${action} selhala`, error instanceof Error ? error.name : "Error");
}

async function setWizardCookie(value: string, maxAgeSeconds: number): Promise<void> {
  const spec = cookieSpec("wizard", await getHost(), maxAgeSeconds);
  (await cookies()).set({ name: spec.name, value, ...spec.options });
}

async function clearWizardCookie(): Promise<void> {
  const expired = expiredCookieSpec("wizard", await getHost());
  (await cookies()).set({ name: expired.name, value: expired.value, ...expired.options });
}

async function readWizardCookie(): Promise<string | undefined> {
  return (await cookies()).get(cookieSpec("wizard", await getHost()).name)?.value;
}

// --- živá kontrola adresy -------------------------------------------------------------------

export type CheckSlugResult = SlugCheckResult | { status: "error" };

export async function checkSlugAction(rawSlug: unknown): Promise<CheckSlugResult> {
  if (!(await originAllowed()) || typeof rawSlug !== "string" || rawSlug.length > 300) {
    return { status: "error" };
  }
  try {
    return await checkSlugAvailability(rawSlug, await getClientIp());
  } catch (error) {
    logFailure("kontrola adresy", error);
    return { status: "error" };
  }
}

// --- souřadnice adresy pro mapu ---------------------------------------------------------------

export type GeocodeActionResult = GeocodeResult | { status: "error" };

/**
 * Souřadnice adresy místa pro mapu (průvodce i editor webu). Anonymní jako kontrola adresy webu:
 * průvodce nemá relaci před prvním uložením; omezení podle IP a společné pro Nominatim je v `geocodeAddress`.
 */
export async function geocodeAddressAction(rawAddress: unknown): Promise<GeocodeActionResult> {
  const address = typeof rawAddress === "string" ? rawAddress.trim() : "";
  if (!(await originAllowed()) || address.length < 3 || address.length > 250) {
    return { status: "error" };
  }
  try {
    return await geocodeAddress(address, await getClientIp());
  } catch (error) {
    logFailure("hledání adresy na mapě", error);
    return { status: "error" };
  }
}

// --- ověření e-mailu při prvním uložení -----------------------------------------------------

export type RequestSaveCodeResult =
  | { status: "sent" }
  | { status: "already_signed_in" }
  | { status: "invalid"; field: "email" | "backupEmail" | "same" }
  | { status: "limited" }
  | { status: "error" };

const emailsSchema = z.object({ email: z.unknown(), backupEmail: z.unknown() });

/** Krok 1 prvního uložení: e-mail správce a záložní e-mail (povinný), kód přijde na první z nich. */
export async function requestSaveCodeAction(input: unknown): Promise<RequestSaveCodeResult> {
  if (!(await originAllowed())) return { status: "error" };
  const parsed = emailsSchema.safeParse(input);
  if (!parsed.success) return { status: "error" };

  const email = normalizeEmail(parsed.data.email);
  const backupEmail = normalizeEmail(parsed.data.backupEmail);
  if (!email) return { status: "invalid", field: "email" };
  if (!backupEmail) return { status: "invalid", field: "backupEmail" };
  // Záložní e-mail je nezávislá cesta zpět; stejná adresa by nic nezajistila.
  if (email === backupEmail) return { status: "invalid", field: "same" };

  try {
    if (await getSession()) return { status: "already_signed_in" };
    const result = await requestWizardCode({
      email,
      ip: await getClientIp(),
      locale: await getUiLocale(),
      defer,
    });
    if (result.status === "limited") return { status: "limited" };
    // Rozpracované ověření patří prohlížeči, který kód vyžádal (zapečetěné e-maily, 10 minut).
    await setWizardCookie(sealPending({ email, backupEmail }), LOGIN_CODE.ttlSeconds);
    return { status: "sent" };
  } catch (error) {
    logFailure("vyžádání kódu", error);
    return { status: "error" };
  }
}

export type VerifySaveCodeResult =
  | { status: "verified" }
  | { status: "invalid" }
  | { status: "format" }
  | { status: "expired" }
  | { status: "limited" }
  | { status: "error" };

/** Krok 2: šestimístný kód (vložený nebo opsaný). Po ověření může první uložení rezervovat adresu. */
export async function verifySaveCodeAction(input: unknown): Promise<VerifySaveCodeResult> {
  if (!(await originAllowed())) return { status: "error" };
  try {
    const token = await readWizardCookie();
    const emails = token ? openPending(token) : null;
    if (!emails) return { status: "expired" };

    const code = parseCode(input);
    if (!code) return { status: "format" };

    const result = await verifyWizardCode({
      email: emails.email,
      code,
      ip: await getClientIp(),
    });
    if (result === "invalid") return { status: "invalid" };
    if (typeof result === "object") return { status: "limited" };

    await setWizardCookie(sealVerified(emails), VERIFIED_SECONDS);
    return { status: "verified" };
  } catch (error) {
    logFailure("ověření kódu", error);
    return { status: "error" };
  }
}

// --- uložení a zveřejnění -------------------------------------------------------------------

export type SaveDraftResult =
  | {
      status: "created";
      slug: string;
      previewUrl: string;
      /** Adresa webu bez schématu pro zobrazení. */
      host: string;
    }
  | {
      status: "saved";
      slug: string | null;
      slugStatus: WizardSlugStatus;
      variants: string[];
      reservedUntil: string | null;
    }
  | { status: "taken"; variants: string[] }
  | { status: "verify_required" }
  | { status: "incomplete"; issues: Issue[] }
  | { status: "not_draft" }
  | { status: "limited" }
  | { status: "error" };

function parseInput(raw: unknown): WizardDraft | null {
  return parseDraft(raw);
}

/**
 * Uložení konceptu. S platnou relací průběžně uloží rozpracovaný koncept; bez relace potřebuje
 * ověřený e-mail (cookie z `verifySaveCodeAction`) a provede první uložení: svatba, správce
 * a rezervace adresy v jedné transakci, potom založí relaci a odkaz na náhled. Při kolizi adresy
 * se nic nezaloží a vrátí se nabídka variant.
 */
export async function saveDraftAction(rawDraft: unknown): Promise<SaveDraftResult> {
  if (!(await originAllowed())) return { status: "error" };
  const draft = parseInput(rawDraft);
  if (!draft) return { status: "error" };

  try {
    const session = await getSession();
    if (session) {
      const result = await updateSave({ weddingId: session.weddingId, draft });
      if (result.status === "limited") return { status: "limited" };
      return result;
    }

    const token = await readWizardCookie();
    const emails = token ? openVerified(token) : null;
    if (!emails) return { status: "verify_required" };

    const result = await firstSave({
      emails,
      draft,
      ip: await getClientIp(),
      backupNotice: { locale: await getUiLocale(), defer },
    });
    if (result.status === "limited") return { status: "limited" };
    if (result.status !== "created") return result;

    await startAdminSession(result.weddingId, result.adminId);
    await clearWizardCookie();
    const host = await getHost();
    return {
      status: "created",
      slug: result.slug,
      previewUrl: previewUrl(
        result.slug,
        result.previewToken,
        host,
        draft.defaultLocale,
        currentHostConfig().rootDomains[0],
      ),
      host: displayHost(result.slug, host, currentHostConfig().rootDomains[0]),
    };
  } catch (error) {
    logFailure("uložení", error);
    return { status: "error" };
  }
}

export type PublishDraftResult =
  | {
      status: "published";
      slug: string;
      url: string;
      host: string;
      /** PIN hostů v prostém tvaru jen pro obrazovku „Hotovo“ (v databázi je jen jeho hash). */
      pin: string | null;
    }
  | { status: "invalid"; issues: Issue[] }
  | { status: "slug_unavailable"; variants: string[] }
  | { status: "unauthorized" }
  | { status: "not_draft" }
  | { status: "limited" }
  | { status: "error" };

/** Zveřejnění: jen s relací správce (kód z e-mailu ověřil první uložení). */
export async function publishDraftAction(rawDraft: unknown): Promise<PublishDraftResult> {
  if (!(await originAllowed())) return { status: "error" };
  const draft = parseInput(rawDraft);
  if (!draft) return { status: "error" };

  try {
    const session = await getSession();
    if (!session) return { status: "unauthorized" };

    const result = await publish({
      weddingId: session.weddingId,
      adminId: session.subjectId,
      draft,
    });
    switch (result.status) {
      case "published": {
        const host = await getHost();
        const root = currentHostConfig().rootDomains[0];
        return {
          status: "published",
          slug: result.slug,
          url: siteUrl(result.slug, host, draft.defaultLocale, root),
          host: displayHost(result.slug, host, root),
          pin: draft.guestPin.enabled ? draft.guestPin.pin : null,
        };
      }
      case "slug_unavailable":
        return { status: "slug_unavailable", variants: result.variants };
      case "limited":
        return { status: "limited" };
      default:
        return result;
    }
  } catch (error) {
    logFailure("zveřejnění", error);
    return { status: "error" };
  }
}

export type RenewPreviewResult =
  { status: "ok"; previewUrl: string } | { status: "unauthorized" } | { status: "error" };

/** Nový odkaz na náhled (starý přestane platit). Jen s relací a jen pro svatbu z relace. */
export async function renewPreviewLinkAction(rawLocale: unknown): Promise<RenewPreviewResult> {
  if (!(await originAllowed())) return { status: "error" };
  const locale = toLocale(typeof rawLocale === "string" ? rawLocale : null);
  try {
    const session = await getSession();
    if (!session) return { status: "unauthorized" };
    const context = await authSessionContext(session.weddingId);
    if (!context?.slug) return { status: "error" };
    const token = await renewPreviewToken({
      weddingId: session.weddingId,
      adminId: session.subjectId,
    });
    return {
      status: "ok",
      previewUrl: previewUrl(
        context.slug,
        token,
        await getHost(),
        locale,
        currentHostConfig().rootDomains[0],
      ),
    };
  } catch (error) {
    logFailure("nový odkaz na náhled", error);
    return { status: "error" };
  }
}

// --- měření ---------------------------------------------------------------------------------

const trackSchema = z.object({
  event: z.enum(["wizard_started", "wizard_step_completed"]),
  step: z.number().int().min(1).max(9).nullable(),
  template: z.enum(["editorial", "eukalyptus", "chateau", "modern"]).nullable(),
});

/**
 * Měřicí událost průvodce z uzavřeného seznamu. Bez osobních údajů (jazyk, šablona a číslo kroku),
 * tiše se zahazuje při chybě nebo překročení limitu a průvodce na ní nikdy nečeká.
 */
export async function trackWizardEventAction(input: unknown): Promise<void> {
  if (!(await originAllowed())) return;
  const parsed = trackSchema.safeParse(input);
  if (!parsed.success) return;
  try {
    await trackFromBrowser({
      ...parsed.data,
      locale: await getUiLocale(),
      ip: await getClientIp(),
    });
  } catch {
    // měření je jen doplněk
  }
}
