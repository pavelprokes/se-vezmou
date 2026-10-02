import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import { env, requireEnv } from "@/env";
import { createTenantClient } from "./client";
import { buildTenantClaims, type MintTenantJwtInput } from "./jwt";

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

/**
 * Totožnost volajícího pro funkce, které čtou claimy JWT (`app.wedding_id()`, `app.wedding_role()`):
 * návštěvník, host po PINu nebo správce jedné svatby. Bez ní se funkce volá jako service role.
 */
export type TenantIdentity = MintTenantJwtInput;
/** Zpětně kompatibilní název pro průvodce. */
export type RpcCaller = TenantIdentity;

export interface RpcTransport {
  /**
   * `table`: pole řádků; `scalar`: jedna hodnota (nebo `null` u `void`). S `as` se funkce volá
   * s rolí `authenticated` a claimy té svatby (stejně jako v produkci přes krátkodobé JWT).
   */
  call(
    fn: string,
    args: Record<string, unknown>,
    kind: RpcKind,
    as?: TenantIdentity,
  ): Promise<unknown>;
}

/** Hlášení, které je jen identifikátor (`rsvp_closed`): u takových zpráv nic osobního být nemůže. */
const REASON_PATTERN = /^[a-z][a-z_]{2,39}$/;

/**
 * Chyba databáze bez argumentů volání (mohou nést osobní údaje): jen funkce, kód a krátká zpráva.
 * `reason` je identifikátor chyby z naší funkce (`invalid_ticket`, `rsvp_closed`), když ho databáze
 * vrátila; jiné texty (typicky systémové hlášení o hodnotě, která chybu způsobila) se zahazují.
 */
export class DbError extends Error {
  readonly reason: string | undefined;

  constructor(
    readonly fn: string,
    readonly code: string | undefined,
    message: string,
  ) {
    super(`Databáze: ${fn} selhala (${code ?? "bez kódu"}): ${message}`);
    this.name = "DbError";
    this.reason = REASON_PATTERN.test(message) ? message : undefined;
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
  async call(fn, args, _kind, as) {
    const payload = Object.fromEntries(
      Object.entries(args)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, toPostgrest(value)]),
    );
    const client = as ? createTenantClient(as) : getServiceClient();
    const { data, error } = await client.rpc(fn, payload);
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
  async call(fn, args, kind, as) {
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
      if (as) {
        // Jako PostgREST: claimy JWT v nastavení transakce a role `authenticated`.
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify(buildTenantClaims(as)),
        ]);
        await client.query("set local role authenticated");
      } else {
        await client.query("set local role service_role");
      }
      const result = await client.query(
        sql,
        entries.map(([, value]) => value),
      );
      await client.query("commit");
      return kind === "table" ? result.rows : (result.rows[0]?.v ?? null);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string }).message ?? "";
      throw new DbError(
        fn,
        code,
        REASON_PATTERN.test(message) ? message : code ? "chyba SQL" : "chyba spojení",
      );
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
