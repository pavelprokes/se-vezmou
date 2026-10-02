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

/** Založí svatbu Kláry a Matěje se správcem a záložním e-mailem; volitelně s PINem správy. */
export async function seedWedding(
  options: { tag?: string; pin?: string | null; partners?: [string, string] } = {},
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
      "insert into public.weddings (id, partner_a_name, partner_b_name, starts_on) values ($1, $2, $3, current_date + 200)",
      [seeded.weddingId, a, b],
    );
    await db.query(
      "insert into public.slug_registry (slug, state, wedding_id, reserved_until) values ($1, 'reserved', $2, now() + interval '30 days')",
      [seeded.slug, seeded.weddingId],
    );
    await db.query("update public.weddings set slug = $1 where id = $2", [
      seeded.slug,
      seeded.weddingId,
    ]);
    await db.query(
      "insert into public.wedding_admins (id, wedding_id, email) values ($1, $2, $3)",
      [seeded.adminId, seeded.weddingId, seeded.adminEmail],
    );
    await db.query(
      "insert into public.wedding_auth (wedding_id, backup_email, admin_pin_hash) values ($1, $2, $3)",
      [seeded.weddingId, seeded.backupEmail, pinHash],
    );
    await db.query("commit");
  });
  return seeded;
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
      "select id, encode(token_hash, 'hex') as token_hash, kind, subject_id, revoked_at, idle_expires_at, absolute_expires_at, last_seen_at from public.sessions where wedding_id = $1 order by created_at",
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
      "select attempts, consumed_at, expires_at, created_at from public.login_challenges where email_hash = $1 order by created_at desc",
      [emailHash(E2E_SECRETS.AUTH_SECRET, email)],
    );
    return result.rows;
  });
}

export async function expireChallenges(email: string): Promise<void> {
  await withDb((db) =>
    db.query(
      "update public.login_challenges set expires_at = now() - interval '1 second' where email_hash = $1",
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
      "select level, failures, extract(epoch from (locked_until - now()))::int as remaining from public.lockouts where bucket_key = $1",
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
      "update public.lockouts set locked_until = now() - interval '1 second' where bucket_key = $1",
      [key],
    ),
  );
}

/** Nasype čítač omezení IP až k limitu (aby test nemusel posílat desítky požadavků). */
export async function exhaustRateLimit(scope: string, value: string, hits: number): Promise<void> {
  const key = rateKey(E2E_SECRETS.RATE_LIMIT_SECRET, scope, value);
  await withDb(async (db) => {
    for (let i = 0; i < hits; i++) {
      await db.query("select * from public.rate_limit_hit($1, 1000000, interval '1 hour')", [key]);
    }
  });
}

export async function emailLogFor(email: string) {
  return withDb(async (db) => {
    const result = await db.query<Record<string, unknown>>(
      "select * from public.email_log where recipient_hash = $1 order by created_at",
      [hmac(E2E_SECRETS.AUTH_SECRET, "email-log", email)],
    );
    return result.rows;
  });
}
