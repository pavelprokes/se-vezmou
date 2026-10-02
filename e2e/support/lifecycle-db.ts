import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { apiRequest, HOSTS } from "../hosts";
import { E2E_SECRETS } from "./env";
import { uniqueTag, withDb } from "./db";

/**
 * Pomocníci e2e testů životního cyklu a retence (M10): založení zveřejněné svatby s hosty a zdravotními údaji,
 * volání cron cest se simulovaným časem a čtení stavu z databáze. Simulovaný čas (`now`) smí cron přijmout
 * jen v testovacím prostředí (`CRON_TEST_CLOCK=1` v playwright.config.ts) a vždy jen spolu s `wedding_id`:
 * cron se tak dotkne jedné testovací svatby, ne dat ostatních testů, které běží ve stejné databázi.
 */

export const CRON_AUTH = `Bearer ${E2E_SECRETS.CRON_SECRET}`;

export interface LifecycleWedding {
  weddingId: string;
  slug: string;
  adminEmail: string;
  guestNames: string[];
  startsOn: string;
}

export async function seedLifecycleWedding(startsOn: string): Promise<LifecycleWedding> {
  const tag = uniqueTag();
  const weddingId = randomUUID();
  const adminId = randomUUID();
  const versionId = randomUUID();
  const householdId = randomUUID();
  const guestIds = [randomUUID(), randomUUID()];
  const responseId = randomUUID();
  const personId = randomUUID();
  const slug = `lc-${tag}`;
  const guestNames = [`Hostka E2E ${tag}`, `Host E2E ${tag}`];
  const adminEmail = `spravce-${slug}@example.test`;

  await withDb(async (db) => {
    await db.query("begin");
    await db.query("set constraints all deferred");
    await db.query(
      "insert into se_vezmou.weddings (id, partner_a_name, partner_b_name, starts_on) values ($1, 'Klára', 'Matěj', $2)",
      [weddingId, startsOn],
    );
    await db.query(
      "insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until) values ($1, 'reserved', $2, now() + interval '30 days')",
      [slug, weddingId],
    );
    await db.query("update se_vezmou.weddings set slug = $1 where id = $2", [slug, weddingId]);
    await db.query("insert into se_vezmou.orders (wedding_id) values ($1)", [weddingId]);
    await db.query(
      "insert into se_vezmou.wedding_admins (id, wedding_id, email) values ($1, $2, $3)",
      [adminId, weddingId, adminEmail],
    );
    await db.query(
      "insert into se_vezmou.wedding_auth (wedding_id, backup_email) values ($1, $2)",
      [weddingId, `zaloha-${slug}@example.test`],
    );
    await db.query(
      "insert into se_vezmou.site_versions (id, wedding_id, version_no, kind, public_content, created_by) values ($1, $2, 1, 'publish', $3, $4)",
      [versionId, weddingId, JSON.stringify({ version: 1, slug, blocks: [] }), adminId],
    );
    await db.query(
      "insert into se_vezmou.site_version_sensitive (version_id, wedding_id, sensitive_content) values ($1, $2, '{}')",
      [versionId, weddingId],
    );
    await db.query(
      "update se_vezmou.weddings set status = 'published', published_version_id = $2 where id = $1",
      [weddingId, versionId],
    );
    await db.query(
      "insert into se_vezmou.households (id, wedding_id, label) values ($1, $2, 'Rodina E2E')",
      [householdId, weddingId],
    );
    for (const [index, guestId] of guestIds.entries()) {
      await db.query(
        "insert into se_vezmou.guests (id, wedding_id, household_id, display_name) values ($1, $2, $3, $4)",
        [guestId, weddingId, householdId, guestNames[index]],
      );
    }
    await db.query(
      "insert into se_vezmou.rsvp_responses (id, wedding_id, household_id) values ($1, $2, $3)",
      [responseId, weddingId, householdId],
    );
    await db.query(
      "insert into se_vezmou.rsvp_people (id, wedding_id, response_id, guest_id, person_name) values ($1, $2, $3, $4, $5)",
      [personId, weddingId, responseId, guestIds[0], guestNames[0]],
    );
    await db.query(
      "insert into se_vezmou.rsvp_health (person_id, wedding_id, diet, allergies) values ($1, $2, 'bezlepková E2E', 'ořechy E2E')",
      [personId, weddingId],
    );
    await db.query(
      "insert into se_vezmou.media (wedding_id, storage_path, mime, width, height, bytes, alt) values ($1, $2, 'image/webp', 640, 480, 1000, '{\"cs\": \"Pár\"}')",
      [weddingId, `${weddingId}/foto/1.webp`],
    );
    await db.query("commit");
  });
  return { weddingId, slug, adminEmail, guestNames, startsOn };
}

export interface WeddingState {
  exists: boolean;
  status: string | null;
  healthRows: number;
  guestRows: number;
  healthPurgeAt: Date | null;
  guestPurgeAt: Date | null;
  purgeAt: Date | null;
  slugState: string | null;
}

export async function weddingState(weddingId: string, slug: string): Promise<WeddingState> {
  return withDb(async (db) => {
    const wedding = await db.query<{
      status: string;
      health_purge_at: Date | null;
      guest_purge_at: Date | null;
      purge_at: Date | null;
    }>(
      "select status, health_purge_at, guest_purge_at, purge_at from se_vezmou.weddings where id = $1",
      [weddingId],
    );
    const count = async (table: string) =>
      Number(
        (
          await db.query<{ n: string }>(
            `select count(*) as n from se_vezmou.${table} where wedding_id = $1`,
            [weddingId],
          )
        ).rows[0].n,
      );
    const registry = await db.query<{ state: string }>(
      "select state from se_vezmou.slug_registry where slug = $1",
      [slug],
    );
    const row = wedding.rows[0];
    return {
      exists: Boolean(row),
      status: row?.status ?? null,
      healthRows: await count("rsvp_health"),
      guestRows:
        (await count("guests")) + (await count("households")) + (await count("rsvp_responses")),
      healthPurgeAt: row?.health_purge_at ?? null,
      guestPurgeAt: row?.guest_purge_at ?? null,
      purgeAt: row?.purge_at ?? null,
      slugState: registry.rows[0]?.state ?? null,
    };
  });
}

export interface CronJobReport {
  job: string;
  status: string;
  counts: Record<string, number>;
  error_code: string | null;
}

export interface CronResponse {
  status: number;
  body: { dry_run?: boolean; jobs?: CronJobReport[]; error?: string };
}

/** Volání cron cesty (hostitel nehraje roli: cesty `/api/cron/*` proxy vynechává). */
export async function callCron(
  request: APIRequestContext,
  path: string,
  options: {
    query?: Record<string, string>;
    authorization?: string | null;
    method?: "GET" | "POST";
  } = {},
): Promise<CronResponse> {
  const search = new URLSearchParams(options.query ?? {}).toString();
  const { url, options: base } = apiRequest(
    HOSTS.marketing,
    `${path}${search ? `?${search}` : ""}`,
  );
  const headers: Record<string, string> = { ...base.headers };
  if (options.authorization !== null) {
    headers.authorization = options.authorization ?? CRON_AUTH;
  }
  const response = await request.fetch(url, {
    method: options.method ?? "GET",
    headers,
    maxRedirects: 0,
  });
  return { status: response.status(), body: await response.json() };
}

/**
 * Spustí úlohu pro jednu svatbu v simulovaném čase a počká, až proběhne (úlohy téhož jména běží nejvýše jedna,
 * souběžný běh se hlásí jako `skipped`: v tom případě se po chvíli zkusí znovu). Vrací zprávu o úloze.
 */
export async function runJobAt(
  request: APIRequestContext,
  job: "lifecycle" | "retention",
  weddingId: string,
  now: string | Date,
): Promise<CronJobReport> {
  const query = {
    wedding_id: weddingId,
    now: typeof now === "string" ? now : now.toISOString(),
  };
  const deadline = Date.now() + 20_000;
  for (;;) {
    const result = await callCron(request, `/api/cron/${job}`, { query });
    if (result.status !== 200) {
      throw new Error(`cron ${job}: ${result.status} ${JSON.stringify(result.body)}`);
    }
    const report = result.body.jobs?.[0];
    if (!report) throw new Error("cron nevrátil zprávu o úloze");
    if (report.status !== "skipped") return report;
    if (Date.now() > deadline) throw new Error(`cron ${job} se nepodařilo spustit (zámek)`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

export async function auditOf(weddingId: string) {
  return withDb(async (db) => {
    const result = await db.query<{
      action: string;
      actor_type: string;
      meta: unknown;
      reason: string | null;
    }>(
      "select action, actor_type, meta, reason from se_vezmou.audit_log where wedding_id = $1 order by id",
      [weddingId],
    );
    return result.rows;
  });
}

export async function lifecycleNotices(weddingId: string) {
  return withDb(async (db) => {
    const result = await db.query<{
      kind: string;
      stage: string;
      status: string;
      recipients: number | null;
    }>(
      "select kind, stage, status, recipients from se_vezmou.lifecycle_notices where wedding_id = $1 order by created_at, id",
      [weddingId],
    );
    return result.rows;
  });
}

export async function emailLogOf(hash: Buffer) {
  return withDb(async (db) => {
    const result = await db.query<{
      type: string;
      status: string;
      recipient_domain: string;
      wedding_id: string | null;
    }>(
      "select type, status, recipient_domain, wedding_id from se_vezmou.email_log where recipient_hash = $1 order by created_at, id",
      [hash],
    );
    return result.rows;
  });
}

export async function markDeleted(weddingId: string): Promise<Date> {
  return withDb(async (db) => {
    const result = await db.query<{ purge_at: Date }>(
      "update se_vezmou.weddings set status = 'deleted' where id = $1 returning purge_at",
      [weddingId],
    );
    return result.rows[0].purge_at;
  });
}
