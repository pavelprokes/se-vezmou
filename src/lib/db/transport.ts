import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import { env, requireEnv } from "@/env";

/**
 * Doprava volání funkcí databáze (RPC). Aplikace volá databázi jen ze serveru a jen přes
 * funkce `security definer` (docs/adr/0001, docs/data-model.md kap. 5.5).
 *
 * - `supabase` (výchozí, produkce): supabase-js s klíčem service role, volání jde přes PostgREST.
 * - `pg` (jen automatické testy, `DB_TRANSPORT=pg`): přímé spojení s PostgreSQL bez PostgREST,
 *   aby šel e2e test spustit proti obyčejnému Postgresu v CI. Každé volání běží v transakci jako
 *   role `service_role`, takže platí stejná oprávnění jako v produkci. V produkci je odmítnuta.
 */

export type RpcKind = "table" | "scalar";

export interface RpcTransport {
  /** `table`: pole řádků; `scalar`: jedna hodnota (nebo `null` u `void`). */
  call(fn: string, args: Record<string, unknown>, kind: RpcKind): Promise<unknown>;
}

/** Chyba databáze bez argumentů volání (mohou nést osobní údaje): jen funkce, kód a krátká zpráva. */
export class DbError extends Error {
  constructor(
    readonly fn: string,
    readonly code: string | undefined,
    message: string,
  ) {
    super(`Databáze: ${fn} selhala (${code ?? "bez kódu"}): ${message}`);
    this.name = "DbError";
  }
}

/** Binární argumenty (bytea) se do PostgREST posílají jako hexadecimální řetězec `\x…`. */
function toPostgrest(value: unknown): unknown {
  return Buffer.isBuffer(value) ? `\\x${value.toString("hex")}` : value;
}

let serviceClient: SupabaseClient | undefined;

/** Klient s klíčem service role. Jen na serveru, nikdy se nepředává prohlížeči. */
export function getServiceClient(): SupabaseClient {
  serviceClient ??= createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    // Žádná relace Supabase Auth: vlastní relace jsou v naší databázi (docs/adr/0002).
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  return serviceClient;
}

const supabaseTransport: RpcTransport = {
  async call(fn, args) {
    const payload = Object.fromEntries(
      Object.entries(args)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, toPostgrest(value)]),
    );
    const { data, error } = await getServiceClient().rpc(fn, payload);
    if (error) throw new DbError(fn, error.code, error.message);
    return data;
  },
};

let pool: Pool | undefined;

async function getPool(): Promise<Pool> {
  if (!pool) {
    const { Pool: PgPool } = await import("pg");
    pool = new PgPool({ connectionString: requireEnv("DATABASE_URL"), max: 5 });
  }
  return pool;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

const pgTransport: RpcTransport = {
  async call(fn, args, kind) {
    if (!IDENTIFIER.test(fn)) throw new Error("Neplatný název funkce");
    const entries = Object.entries(args).filter(([, value]) => value !== undefined);
    for (const [key] of entries) {
      if (!IDENTIFIER.test(key)) throw new Error("Neplatný název argumentu");
    }
    const placeholders = entries.map(([key], index) => `${key} => $${index + 1}`).join(", ");
    const sql =
      kind === "table"
        ? `select * from public.${fn}(${placeholders})`
        : `select public.${fn}(${placeholders}) as v`;

    const client = await (await getPool()).connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      const result = await client.query(
        sql,
        entries.map(([, value]) => value),
      );
      await client.query("commit");
      return kind === "table" ? result.rows : (result.rows[0]?.v ?? null);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      const code = (error as { code?: string }).code;
      throw new DbError(fn, code, code ? "chyba SQL" : "chyba spojení");
    } finally {
      client.release();
    }
  },
};

export function getTransport(): RpcTransport {
  if (env.DB_TRANSPORT === "pg") {
    // Pojistka: testovací doprava nesmí běžet v ostré produkci.
    if (process.env.VERCEL_ENV === "production") {
      throw new Error("DB_TRANSPORT=pg není v produkci povolen");
    }
    return pgTransport;
  }
  return supabaseTransport;
}
