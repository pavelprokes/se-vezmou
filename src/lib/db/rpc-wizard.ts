import "server-only";
import { call, firstRow, READ_ONLY, type Bytes } from "./rpc";
import type { CheckSlugReason } from "./types";

/**
 * Typovaný obal funkcí databáze pro průvodce (M5), čekací listinu a analytiku
 * (`supabase/migrations/20261002150000_wizard.sql`). Stejná pravidla jako `rpc.ts`: jedna funkce
 * SQL = jedna metoda, jen server, jen service role (kromě `getPublicSite`, které jde s claimy svatby).
 */

// --- čekací listina a analytika ------------------------------------------------------------

/** `true` při novém e-mailu, `false` při opakovaném (volající to uživateli nesděluje). */
export function waitlistAdd(
  email: string,
  locale: "cs" | "en" | null,
  consentTextVersion: string,
): Promise<boolean> {
  return call<boolean>(
    "waitlist_add",
    { p_email: email, p_locale: locale, p_consent_text_version: consentTextVersion },
    "scalar",
  );
}

export type AnalyticsEvent =
  "wizard_started" | "wizard_step_completed" | "site_published" | "rsvp_completed";

export async function analyticsRecord(input: {
  event: AnalyticsEvent;
  locale?: "cs" | "en" | null;
  template?: string | null;
  step?: number | null;
}): Promise<void> {
  await call(
    "analytics_record",
    {
      p_event: input.event,
      p_locale: input.locale ?? null,
      p_template: input.template ?? null,
      p_step: input.step ?? null,
    },
    "scalar",
  );
}

// --- adresy: informativní kontrola ---------------------------------------------------------

export type SlugCheck = { available: boolean | null; reason: CheckSlugReason; retryAfter: number };

/**
 * Informativní dostupnost adresy s omezením počtu dotazů přímo v databázi. Důvod `unavailable`
 * je stejný pro zabranou, rezervovanou i blokovanou adresu (nic se neprozradí).
 */
export async function checkSlug(
  slug: string,
  rate?: { key: string; limit: number; windowSeconds: number },
): Promise<SlugCheck> {
  const row = await firstRow<{
    available: boolean | null;
    reason: CheckSlugReason;
    retry_after: number;
  }>("check_slug", {
    p_slug: slug,
    p_rate_key: rate?.key,
    p_rate_limit: rate?.limit,
    p_rate_window: rate ? `${rate.windowSeconds} seconds` : undefined,
  });
  if (!row) throw new Error("check_slug nevrátila řádek");
  return { available: row.available, reason: row.reason, retryAfter: row.retry_after };
}

// --- průvodce ------------------------------------------------------------------------------

export type WizardCreateResult =
  { ok: true; weddingId: string; adminId: string } | { ok: false; variants: string[] };

/**
 * První uložení: svatba, správce, záložní e-mail, zakázka a rezervace adresy v jedné transakci.
 * E-mail správce musí volající předem ověřit kódem.
 */
export async function wizardCreateDraft(input: {
  email: string;
  backupEmail: string;
  slug: string;
  draft: unknown;
  work: unknown;
}): Promise<WizardCreateResult> {
  const row = await firstRow<{
    ok: boolean;
    wedding_id: string | null;
    admin_id: string | null;
    variants: string[];
  }>("wizard_create_draft", {
    p_email: input.email,
    p_backup_email: input.backupEmail,
    p_slug: input.slug,
    p_draft: input.draft,
    p_work: input.work,
  });
  if (!row) throw new Error("wizard_create_draft nevrátila řádek");
  return row.ok && row.wedding_id && row.admin_id
    ? { ok: true, weddingId: row.wedding_id, adminId: row.admin_id }
    : { ok: false, variants: row.variants ?? [] };
}

export type WizardSlugStatus = "ok" | "taken" | "invalid" | "none";

export type WizardSaveResult = {
  slug: string | null;
  slugStatus: WizardSlugStatus;
  variants: string[];
  reservedUntil: Date | null;
};

export async function wizardSave(input: {
  weddingId: string;
  slug: string | null;
  draft: unknown;
  work: unknown;
}): Promise<WizardSaveResult> {
  const row = await firstRow<{
    slug: string | null;
    slug_status: WizardSlugStatus;
    variants: string[];
    reserved_until: string | Date | null;
  }>("wizard_save", {
    p_wedding_id: input.weddingId,
    p_slug: input.slug,
    p_draft: input.draft,
    p_work: input.work,
  });
  if (!row) throw new Error("wizard_save nevrátila řádek");
  return {
    slug: row.slug,
    slugStatus: row.slug_status,
    variants: row.variants ?? [],
    reservedUntil: row.reserved_until ? new Date(row.reserved_until) : null,
  };
}

export type WizardState = {
  status: string;
  slug: string | null;
  reservedUntil: Date | null;
  draft: unknown;
  previewEnabled: boolean;
};

export async function wizardLoad(weddingId: string): Promise<WizardState | null> {
  const row = await firstRow<{
    status: string;
    slug: string | null;
    reserved_until: string | Date | null;
    draft: unknown;
    preview_enabled: boolean;
  }>("wizard_load", { p_wedding_id: weddingId });
  return row
    ? {
        status: row.status,
        slug: row.slug,
        reservedUntil: row.reserved_until ? new Date(row.reserved_until) : null,
        draft: row.draft,
        previewEnabled: row.preview_enabled,
      }
    : null;
}

export async function setPreviewToken(
  weddingId: string,
  tokenHash: Bytes,
  actorAdminId: string | null,
): Promise<void> {
  await call(
    "set_preview_token",
    { p_wedding_id: weddingId, p_token_hash: tokenHash, p_actor_admin_id: actorAdminId },
    "scalar",
  );
}

/** Svatba, jejíž koncept odpovídá adrese a hashi tokenu z odkazu na náhled. */
export async function resolvePreview(slug: string, tokenHash: Bytes): Promise<string | null> {
  const row = await firstRow<{ wedding_id: string }>(
    "resolve_preview",
    {
      p_slug: slug,
      p_token_hash: tokenHash,
    },
    READ_ONLY,
  );
  return row?.wedding_id ?? null;
}

export async function publishSite(input: {
  weddingId: string;
  actorAdminId: string;
  publicContent: unknown;
  sensitive: unknown;
}): Promise<{ versionNo: number; slug: string }> {
  const row = await firstRow<{ version_no: number; slug: string }>("publish_site", {
    p_wedding_id: input.weddingId,
    p_actor_admin_id: input.actorAdminId,
    p_public_content: input.publicContent,
    p_sensitive: input.sensitive,
  });
  if (!row) throw new Error("publish_site nevrátila řádek");
  return { versionNo: row.version_no, slug: row.slug };
}

/**
 * Zveřejněný snímek (`visitor`) nebo koncept podle odkazu na náhled (`preview`) z funkce
 * `get_public_site`. Volá se s claimy svatby, ne jako service role (docs/data-model.md kap. 5.5).
 */
export function getPublicSite(
  weddingId: string,
  weddingRole: "visitor" | "preview",
): Promise<unknown> {
  return call<unknown>("get_public_site", {}, "scalar", { weddingId, weddingRole }, READ_ONLY);
}
