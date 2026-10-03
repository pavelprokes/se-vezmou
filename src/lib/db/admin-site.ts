import "server-only";
import { tenantRpc } from "./rpc";
import type { TenantIdentity } from "./transport";

/**
 * Tenký typovaný obal funkcí správy webu (M7a, `supabase/migrations/20261006100000_admin_site.sql`).
 * Všechny běží s claimy správce jedné svatby (role `authenticated`), svatba se nikdy nepředává jako
 * argument: je jen z relace. Odpovědi se ověřují schématy v `src/admin/site`.
 */

export type AdminIdentity = { weddingId: string; subjectId: string };

function identity(session: AdminIdentity): TenantIdentity {
  return { weddingId: session.weddingId, weddingRole: "admin", subject: session.subjectId };
}

export function adminSiteLoad(session: AdminIdentity): Promise<unknown> {
  return tenantRpc<unknown>(identity(session), "admin_site_load");
}

export type SaveRow = { ok: boolean; conflict: boolean; rev: number };

export async function adminSiteSave(
  session: AdminIdentity,
  baseRev: number,
  work: unknown,
  options: { touch?: boolean } = {},
): Promise<SaveRow> {
  const rows = await tenantRpc<SaveRow[]>(
    identity(session),
    "admin_site_save",
    { p_base_rev: baseRev, p_work: work, p_touch: options.touch ?? true },
    "table",
  );
  const row = rows[0];
  if (!row) throw new Error("admin_site_save nevrátila řádek");
  return row;
}

/**
 * Zveřejnění snímku sestaveného z pracovní kopie ve verzi `baseRev`. Když se revize mezitím změnila (druhé okno,
 * druhý správce), databáze nic nezveřejní a vrátí `conflict`.
 */
export async function adminSitePublish(
  session: AdminIdentity,
  input: { publicContent: unknown; sensitive: unknown; note?: string | null; baseRev: number },
): Promise<{ conflict: true } | { conflict: false; versionNo: number; slug: string }> {
  const rows = await tenantRpc<
    { ok: boolean; conflict: boolean; version_no: number | null; slug: string | null }[]
  >(
    identity(session),
    "admin_site_publish",
    {
      p_public: input.publicContent,
      p_sensitive: input.sensitive,
      p_note: input.note ?? null,
      p_base_rev: input.baseRev,
    },
    "table",
  );
  const row = rows[0];
  if (!row) throw new Error("admin_site_publish nevrátila řádek");
  if (row.conflict || row.version_no === null || row.slug === null) return { conflict: true };
  return { conflict: false, versionNo: row.version_no, slug: row.slug };
}

export async function adminSiteUnpublish(session: AdminIdentity): Promise<void> {
  await tenantRpc(identity(session), "admin_site_unpublish");
}

export async function adminSiteCheckpoint(
  session: AdminIdentity,
  input: { publicContent: unknown; sensitive: unknown; note?: string | null },
): Promise<number> {
  const rows = await tenantRpc<{ version_no: number }[]>(
    identity(session),
    "admin_site_checkpoint",
    { p_public: input.publicContent, p_sensitive: input.sensitive, p_note: input.note ?? null },
    "table",
  );
  const row = rows[0];
  if (!row) throw new Error("admin_site_checkpoint nevrátila řádek");
  return row.version_no;
}

export function adminSiteVersionGet(session: AdminIdentity, versionId: string): Promise<unknown> {
  return tenantRpc<unknown>(identity(session), "admin_site_version_get", {
    p_version_id: versionId,
  });
}

export async function adminQuickNoticeSet(
  session: AdminIdentity,
  notice: Record<string, string> | null,
  enabled: boolean,
): Promise<void> {
  await tenantRpc(identity(session), "admin_quick_notice_set", {
    p_notice: notice,
    p_enabled: enabled,
  });
}

export type MyWedding = {
  adminId: string;
  weddingId: string;
  slug: string | null;
  status: string;
  partnerAName: string;
  partnerBName: string;
  isCurrent: boolean;
};

export async function adminMyWeddings(session: AdminIdentity): Promise<MyWedding[]> {
  const rows = await tenantRpc<
    {
      admin_id: string;
      wedding_id: string;
      slug: string | null;
      status: string;
      partner_a_name: string;
      partner_b_name: string;
      is_current: boolean;
    }[]
  >(identity(session), "admin_my_weddings", {}, "table");
  return rows.map((row) => ({
    adminId: row.admin_id,
    weddingId: row.wedding_id,
    slug: row.slug,
    status: row.status,
    partnerAName: row.partner_a_name,
    partnerBName: row.partner_b_name,
    isCurrent: row.is_current,
  }));
}
