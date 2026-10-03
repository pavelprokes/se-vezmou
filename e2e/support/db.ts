import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { hmac } from "../../src/auth/crypto";
import { emailHash } from "../../src/auth/identity";
import { hashPin } from "../../src/auth/pin";
import { rateKey } from "../../src/auth/rate-limit";
import { databaseUrl, E2E_SECRETS } from "./env";

/** Přímý přístup k databázi e2e testů (jako vlastník, mimo RLS): zakládání dat a kontrola stavu. */

export async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export interface SeededWedding {
  tag: string;
  weddingId: string;
  adminId: string;
  slug: string;
  adminEmail: string;
  backupEmail: string;
  pin: string | null;
}

/** Krátká náhodná značka pro adresy a e-maily jednoho testu (testy běží paralelně nad jednou databází). */
export function uniqueTag(): string {
  return randomBytes(4).toString("hex");
}

export function randomIp(): string {
  const byte = () => 1 + Math.floor(Math.random() * 253);
  return `198.51.${byte()}.${byte()}`;
}

/**
 * Založí svatbu Kláry a Matěje se správcem a záložním e-mailem; volitelně s PINem správy. Záložní e-mail je
 * výchozně potvrzený (chodí na něj oznámení); `backupConfirmed: false` ověřuje, že nepotvrzená adresa nedostane nic.
 */
export async function seedWedding(
  options: {
    tag?: string;
    pin?: string | null;
    partners?: [string, string];
    backupConfirmed?: boolean;
  } = {},
): Promise<SeededWedding> {
  const tag = options.tag ?? uniqueTag();
  const [a, b] = options.partners ?? ["Klára", "Matěj"];
  const seeded: SeededWedding = {
    tag,
    weddingId: randomUUID(),
    adminId: randomUUID(),
    slug: `e2e-${tag}`,
    adminEmail: `spravce-${tag}@example.test`,
    backupEmail: `zaloha-${tag}@example.test`,
    pin: options.pin === undefined ? null : options.pin,
  };
  const pinHash = seeded.pin ? await hashPin(seeded.pin, E2E_SECRETS.PIN_PEPPER) : null;

  await withDb(async (db) => {
    await db.query("begin");
    await db.query("set constraints all deferred");
    await db.query(
      "insert into se_vezmou.weddings (id, partner_a_name, partner_b_name, starts_on) values ($1, $2, $3, current_date + 200)",
      [seeded.weddingId, a, b],
    );
    await db.query(
      "insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until) values ($1, 'reserved', $2, now() + interval '30 days')",
      [seeded.slug, seeded.weddingId],
    );
    await db.query("update se_vezmou.weddings set slug = $1 where id = $2", [
      seeded.slug,
      seeded.weddingId,
    ]);
    await db.query(
      "insert into se_vezmou.wedding_admins (id, wedding_id, email) values ($1, $2, $3)",
      [seeded.adminId, seeded.weddingId, seeded.adminEmail],
    );
    await db.query(
      "insert into se_vezmou.wedding_auth (wedding_id, backup_email, admin_pin_hash, backup_email_confirmed_at) values ($1, $2, $3, case when $4::boolean then now() end)",
      [seeded.weddingId, seeded.backupEmail, pinHash, options.backupConfirmed ?? true],
    );
    await db.query("commit");
  });
  return seeded;
}

export interface SeededSite {
  weddingId: string;
  slug: string;
}

/**
 * Založí zveřejněný web přímo v databázi (jako vlastník, mimo RLS): svatba, správce, rezervace
 * adresy, verze webu a přepnutí na `published`. Slouží testům webu páru a hostitelů, které
 * potřebují hotový web bez průchodu průvodcem. `phase_override` drží fázi stálou (nezávislou na
 * dnešním datu), `quick_notice` je „rychlá změna“ z ukázkového obsahu.
 */
export async function seedPublishedSite(options: {
  slug: string;
  content: {
    slug: string;
    partners: { a: string; b: string };
    startsOn: string;
    endsOn: string | null;
    locales: string[];
    defaultLocale: string;
    template: string;
    palette: string;
    phase: string;
    quickNotice: unknown;
  };
  status?: "published" | "blocked";
}): Promise<SeededSite> {
  const { slug, content } = options;
  const weddingId = randomUUID();
  const adminId = randomUUID();
  const versionId = randomUUID();
  await withDb(async (db) => {
    await db.query("begin");
    await db.query("set constraints all deferred");
    await db.query(
      `insert into se_vezmou.weddings (id, partner_a_name, partner_b_name, starts_on, ends_on, default_locale, locales, template, palette)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        weddingId,
        content.partners.a,
        content.partners.b,
        content.startsOn,
        content.endsOn,
        content.defaultLocale,
        content.locales,
        content.template,
        content.palette,
      ],
    );
    await db.query(
      "insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until) values ($1, 'reserved', $2, now() + interval '30 days')",
      [slug, weddingId],
    );
    await db.query("update se_vezmou.weddings set slug = $1 where id = $2", [slug, weddingId]);
    await db.query("insert into se_vezmou.orders (wedding_id) values ($1)", [weddingId]);
    await db.query(
      "insert into se_vezmou.wedding_admins (id, wedding_id, email) values ($1, $2, $3)",
      [adminId, weddingId, `spravce-${slug}@example.test`],
    );
    await db.query(
      "insert into se_vezmou.wedding_auth (wedding_id, backup_email, backup_email_confirmed_at) values ($1, $2, now())",
      [weddingId, `zaloha-${slug}@example.test`],
    );
    await db.query(
      "insert into se_vezmou.site_versions (id, wedding_id, version_no, kind, public_content, created_by) values ($1, $2, 1, 'publish', $3, $4)",
      [versionId, weddingId, JSON.stringify(content), adminId],
    );
    await db.query(
      "insert into se_vezmou.site_version_sensitive (version_id, wedding_id, sensitive_content) values ($1, $2, '{}')",
      [versionId, weddingId],
    );
    await db.query(
      `update se_vezmou.weddings set status = 'published', published_version_id = $2, phase_override = $3,
         quick_notice = $4, quick_notice_enabled = $5 where id = $1`,
      [
        weddingId,
        versionId,
        content.phase,
        content.quickNotice ? JSON.stringify(content.quickNotice) : null,
        Boolean(content.quickNotice),
      ],
    );
    if (options.status === "blocked") {
      await db.query("update se_vezmou.weddings set status = 'blocked' where id = $1", [weddingId]);
    }
    await db.query("commit");
  });
  return { weddingId, slug };
}

export async function sessionsOf(weddingId: string) {
  return withDb(async (db) => {
    const result = await db.query<{
      id: string;
      token_hash: string;
      kind: string;
      subject_id: string | null;
      revoked_at: Date | null;
      idle_expires_at: Date;
      absolute_expires_at: Date;
      last_seen_at: Date;
    }>(
      "select id, encode(token_hash, 'hex') as token_hash, kind, subject_id, revoked_at, idle_expires_at, absolute_expires_at, last_seen_at from se_vezmou.sessions where wedding_id = $1 order by created_at",
      [weddingId],
    );
    return result.rows;
  });
}

export async function challengeOf(email: string) {
  return withDb(async (db) => {
    const result = await db.query<{
      attempts: number;
      consumed_at: Date | null;
      expires_at: Date;
      created_at: Date;
    }>(
      "select attempts, consumed_at, expires_at, created_at from se_vezmou.login_challenges where email_hash = $1 order by created_at desc",
      [emailHash(E2E_SECRETS.AUTH_SECRET, email)],
    );
    return result.rows;
  });
}

export async function expireChallenges(email: string): Promise<void> {
  await withDb((db) =>
    db.query(
      "update se_vezmou.login_challenges set expires_at = now() - interval '1 second' where email_hash = $1",
      [emailHash(E2E_SECRETS.AUTH_SECRET, email)],
    ),
  );
}

export async function lockoutsFor(slug: string) {
  const key = rateKey(E2E_SECRETS.RATE_LIMIT_SECRET, "pin-admin-wedding", slug);
  return withDb(async (db) => {
    const result = await db.query<{
      level: number;
      failures: number;
      remaining: number | null;
    }>(
      "select level, failures, extract(epoch from (locked_until - now()))::int as remaining from se_vezmou.lockouts where bucket_key = $1",
      [key],
    );
    return result.rows[0] ?? null;
  });
}

/** Ukončí pauzu PINu (simulace uplynutí času, aby test nečekal minuty). */
export async function endLockout(slug: string): Promise<void> {
  const key = rateKey(E2E_SECRETS.RATE_LIMIT_SECRET, "pin-admin-wedding", slug);
  await withDb((db) =>
    db.query(
      "update se_vezmou.lockouts set locked_until = now() - interval '1 second' where bucket_key = $1",
      [key],
    ),
  );
}

/** Nasype čítač omezení IP až k limitu (aby test nemusel posílat desítky požadavků). */
export async function exhaustRateLimit(
  scope: string,
  value: string,
  hits: number,
  windowSeconds = 3600,
): Promise<void> {
  const key = rateKey(E2E_SECRETS.RATE_LIMIT_SECRET, scope, value);
  // Čítač má pevná okna zarovnaná na epochu (`rate_limit_hit`). Kdyby hranice okna přišla, než test čítač použije,
  // začalo by nové okno s nulou a limit by nebyl vyčerpán (nestabilní test). Blízko hranice proto počkáme na nové okno.
  const intoWindowMs = Date.now() % (windowSeconds * 1000);
  const leftMs = windowSeconds * 1000 - intoWindowMs;
  if (leftMs < 25_000) await new Promise((resolve) => setTimeout(resolve, leftMs + 500));
  await withDb(async (db) => {
    for (let i = 0; i < hits; i++) {
      // Okno musí mít stejnou délku jako v aplikaci, jinak je to jiný čítač.
      await db.query(
        "select * from se_vezmou.rate_limit_hit($1, 1000000, make_interval(secs => $2))",
        [key, windowSeconds],
      );
    }
  });
}

export async function emailLogFor(email: string) {
  return withDb(async (db) => {
    const result = await db.query<Record<string, unknown>>(
      "select * from se_vezmou.email_log where recipient_hash = $1 order by created_at",
      [hmac(E2E_SECRETS.AUTH_SECRET, "email-log", email)],
    );
    return result.rows;
  });
}
