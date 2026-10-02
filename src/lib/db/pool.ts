import "server-only";
import type { Pool, PoolConfig } from "pg";

/**
 * Spojení s PostgreSQL (docs/adr/0011): přímý `pg` (Pool) přes pooler Supabase v transaction módu
 * (Supavisor, port 6543) jako role `se_vezmou_app`. Žádný PostgREST ani supabase-js.
 *
 * Zásady pro Vercel (serverless/Fluid) a Supavisor v transaction módu:
 *  - malý `max`: každé volání drží spojení jen po dobu jedné transakce, pooler spojení sdílí;
 *  - žádné pojmenované prepared statements: `pg` používá bezejmenné, kdyby se někdy předalo
 *    `name`, dotaz by mohl skončit na jiném spojení poolu. Proto se `name` nikdy nepředává;
 *  - rozumné timeouty (spojení, dotaz, nečinnost) a `application_name` pro dohledání v logu;
 *  - TLS: viz `tlsFromUrl`.
 */

export const POOL_MAX = 5;
const CONNECTION_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 10_000;
const STATEMENT_TIMEOUT_MS = 20_000;
const QUERY_TIMEOUT_MS = 25_000;

type Env = Record<string, string | undefined>;

/** Adresa databáze: `DATABASE_URL`, záložně `SUPABASE_URL`, ale jen pokud je to postgres(ql):// adresa. */
export function resolveDatabaseUrl(env: Env = process.env): string | undefined {
  const primary = env.DATABASE_URL?.trim();
  if (primary) return primary;
  const fallback = env.SUPABASE_URL?.trim();
  if (fallback && /^postgres(ql)?:\/\//i.test(fallback)) return fallback;
  return undefined;
}

const LOOPBACK = new Set(["", "localhost", "127.0.0.1", "[::1]", "::1"]);

/** Spojení po unixovém socketu nebo na loopback (lokální vývoj, e2e, CI). */
function isLocalHost(host: string): boolean {
  return LOOPBACK.has(host) || host.startsWith("/");
}

/**
 * TLS spojení. Rozhoduje parametr `sslmode` v adrese (stejné názvy jako libpq), ostatní `ssl*`
 * parametry se ignorují, aby `pg` nevybralo jiné chování než zdokumentované:
 *  - `disable`: bez TLS, jen pro loopback a unixový socket (jinak chyba);
 *  - `require` (výchozí pro vzdálenou databázi): TLS bez ověření řetězu certifikátů. Pooler Supabase
 *    má certifikát podepsaný vlastní CA Supabase, kterou systémové úložiště nezná. Provoz je šifrovaný,
 *    ale nechrání proti aktivnímu útočníkovi v síti;
 *  - `verify-full`, nebo `require` s nastaveným `DATABASE_CA_CERT` (PEM kořenové CA Supabase):
 *    ověření řetězu i názvu serveru. DOPORUČENO po doplnění certifikátu (docs/open-questions.md).
 * Bez `sslmode` je výchozí `disable` pro loopback/socket a `require` jinak.
 */
export function tlsFromUrl(url: URL, env: Env = process.env): PoolConfig["ssl"] {
  const host =
    url.searchParams.get("host") ?? (url.hostname === "socket.invalid" ? "" : url.hostname);
  const local = isLocalHost(host);
  const mode = url.searchParams.get("sslmode") ?? (local ? "disable" : "require");
  const ca = env.DATABASE_CA_CERT?.trim() || undefined;

  switch (mode) {
    case "disable":
      if (!local)
        throw new Error("DATABASE_URL: sslmode=disable je povoleno jen pro lokální databázi");
      return false;
    case "require":
    case "prefer":
    case "no-verify":
      return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
    case "verify-ca":
    case "verify-full":
      return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true };
    default:
      throw new Error("DATABASE_URL: neznámá hodnota sslmode");
  }
}

/** Nastavení poolu z adresy databáze. Chybná adresa je chyba nasazení (jasná zpráva bez hesla). */
export function poolConfigFromUrl(rawUrl: string, env: Env = process.env): PoolConfig {
  let url: URL;
  try {
    // `postgresql://uzivatel@/db?host=/cesta/k/socketu` (unixový socket) WHATWG URL nepřijme:
    // prázdný hostitel nahradíme zástupným, skutečný je v parametru `host`.
    url = new URL(rawUrl.replace(/^(postgres(?:ql)?:\/\/[^/@]*)@\//i, "$1@socket.invalid/"));
  } catch {
    throw new Error("DATABASE_URL není platná adresa postgresql://…");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL musí začínat postgres:// nebo postgresql://");
  }

  const hostParam = url.searchParams.get("host");
  const hostname = url.hostname === "socket.invalid" ? "" : url.hostname;
  return {
    // Pole se předávají samostatně (ne connectionString): `ssl` z adresy by přebilo naše rozhodnutí.
    host: hostParam || hostname || undefined,
    port: url.port ? Number(url.port) : undefined,
    user: decodeURIComponent(url.username) || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || undefined,
    ssl: tlsFromUrl(url, env),
    max: POOL_MAX,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    idle_in_transaction_session_timeout: QUERY_TIMEOUT_MS,
    application_name: "se-vezmou",
    allowExitOnIdle: true,
  };
}

let pool: Pool | undefined;

/**
 * Sdílený pool procesu (vytvoří se při prvním volání, ne při sestavení). Bez adresy databáze selže
 * s jasnou zprávou: v produkci je `pg` jediná cesta k databázi.
 */
export async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error(
      "Chybí DATABASE_URL (postgresql:// adresa poolu Supabase pro roli se_vezmou_app, docs/adr/0011)",
    );
  }
  const { Pool: PgPool } = await import("pg");
  const created = new PgPool(poolConfigFromUrl(url));
  // Chyba nečinného spojení (restart poolu, ztráta sítě) nesmí shodit proces; spojení se zahodí.
  created.on("error", () => undefined);
  try {
    // Vercel Fluid: funkce zůstane naživu, dokud pool neuzavře nečinná spojení.
    const { attachDatabasePool } = await import("@vercel/functions");
    attachDatabasePool(created);
  } catch {
    // mimo Vercel (lokálně, CI) není co připojovat
  }
  pool = created;
  return pool;
}
