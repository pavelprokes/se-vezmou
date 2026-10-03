#!/usr/bin/env node
// Nasazení migrací databáze se-vezmou.cz (docs/adr/0011, supabase/README.md).
//
//   MIGRATE_DATABASE_URL=postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres \
//     npm run db:migrate -- --dry-run      # jen vypíše plán, nic nezapíše
//   npm run db:migrate                     # aplikuje čekající migrace
//   npm run db:migrate -- --status         # stav všech migrací
//
// Jen node + pg, bez Supabase CLI. Aplikuje supabase/migrations/*.sql v pořadí názvů, KAŽDOU v jedné
// transakci, a eviduje je v se_vezmou.schema_migrations (version, name, checksum sha256, applied_at),
// NE v globální supabase_migrations (sdílený projekt). Změněná, už aplikovaná migrace se odmítne.
// Nástroj nikdy nemaže data: migrace s `drop schema|table|column`, `truncate` nebo `delete from`
// na nejvyšší úrovni se odmítne dřív, než se cokoli spustí.
//
// MIGRATE_DATABASE_URL je spojení VLASTNÍKA schématu (role postgres), přímé nebo přes session pooler
// (port 5432), NIKDY aplikační role se_vezmou_app a NIKDY transaction pooler (port 6543). Heslo se nikam
// nevypisuje. U vzdálené databáze je POVINNÉ MIGRATE_CA_CERT (PEM kořenové CA Supabase): spojení ověřuje
// certifikát serveru. Bez něj nástroj odmítne běžet, pokud výslovně nenastavíte MIGRATE_TLS_INSECURE=1
// (TLS bez ověření řetězu, nedoporučeno). Lokální databáze (loopback, unixový socket) je bez TLS.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DIR = join(ROOT, "supabase", "migrations");
const FILE_RE = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const APP_ROLE = "se_vezmou_app";
const LOCK_KEY = "se_vezmou.db_migrate";

export class MigrateError extends Error {}

function fail(message) {
  throw new MigrateError(message);
}

export function parseArgs(argv) {
  const opts = { dryRun: false, status: false, dir: DEFAULT_DIR, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--status") opts.status = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--dir") opts.dir = resolve(argv[++i] ?? fail("--dir vyžaduje cestu"));
    else fail(`Neznámý argument: ${a}`);
  }
  if (opts.dryRun && opts.status) fail("--dry-run a --status nelze kombinovat");
  return opts;
}

/** Načte migrace z adresáře: version (časová předpona), name, checksum sha256 obsahu souboru. */
export function loadMigrations(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const seen = new Set();
  return files.map((file) => {
    const m = FILE_RE.exec(file);
    if (!m) fail(`Název migrace ${file} neodpovídá vzoru RRRRMMDDHHMMSS_nazev.sql`);
    if (seen.has(m[1])) fail(`Dvě migrace mají stejnou verzi ${m[1]}`);
    seen.add(m[1]);
    const sql = readFileSync(join(dir, file));
    return {
      version: m[1],
      name: m[2],
      file,
      sql: sql.toString("utf8"),
      checksum: createHash("sha256").update(sql).digest("hex"),
    };
  });
}

/** Zakázané příkazy na nejvyšší úrovni (od začátku řádku): migrace nesmí mazat data ani objekty. */
const DESTRUCTIVE = [
  /^drop\s+(schema|table|database|owned|column)\b/im,
  /^truncate\b/im,
  /^delete\s+from\b/im,
  /^alter\s+table\b[^;]*\bdrop\s+column\b/im,
];

export function destructiveStatement(sql) {
  const stripped = sql.replace(/--[^\n]*/g, "");
  for (const re of DESTRUCTIVE) {
    const m = re.exec(stripped);
    if (m) return m[0].trim().split(/\s+/).slice(0, 3).join(" ");
  }
  return null;
}

const LOOPBACK = new Set(["", "localhost", "127.0.0.1", "[::1]", "::1"]);

/** Nastavení spojení z MIGRATE_DATABASE_URL; chyby nikdy neobsahují heslo. */
export function clientConfig(rawUrl, env = process.env) {
  let url;
  try {
    // unixový socket: `postgresql://uzivatel@/db?host=/cesta`
    url = new URL(rawUrl.replace(/^(postgres(?:ql)?:\/\/[^/@]*)@\//i, "$1@socket.invalid/"));
  } catch {
    fail("MIGRATE_DATABASE_URL není platná adresa postgresql://…");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    fail("MIGRATE_DATABASE_URL musí začínat postgres:// nebo postgresql://");
  }
  const user = decodeURIComponent(url.username);
  if (user === APP_ROLE || user.startsWith(`${APP_ROLE}.`)) {
    fail(
      `MIGRATE_DATABASE_URL míří na aplikační roli ${APP_ROLE}. Migrace musí aplikovat vlastník (role postgres), ` +
        "aplikační role k tomu nemá práva a nesmí je mít.",
    );
  }
  if (url.port === "6543") {
    fail(
      "MIGRATE_DATABASE_URL míří na port 6543 (transaction pooler). Migrace potřebují přímé spojení nebo session " +
        "pooler (port 5432).",
    );
  }
  const hostParam = url.searchParams.get("host");
  const hostname = url.hostname === "socket.invalid" ? "" : url.hostname;
  const host = hostParam || hostname || undefined;
  const local = LOOPBACK.has(host ?? "") || (host ?? "").startsWith("/");
  const mode = url.searchParams.get("sslmode") ?? (local ? "disable" : "require");
  const ca = (env.MIGRATE_CA_CERT ?? "").trim() || undefined;
  let ssl;
  if (mode === "disable") {
    if (!local) fail("MIGRATE_DATABASE_URL: sslmode=disable je povoleno jen pro lokální databázi");
    ssl = false;
  } else if (["require", "prefer", "no-verify"].includes(mode)) {
    if (ca) ssl = { ca, rejectUnauthorized: true };
    else if ((env.MIGRATE_TLS_INSECURE ?? "").trim() === "1" || local)
      ssl = { rejectUnauthorized: false };
    else
      fail(
        "MIGRATE_DATABASE_URL: vzdálená databáze vyžaduje ověření certifikátu. Nastavte MIGRATE_CA_CERT " +
          "(PEM kořenové CA Supabase), nebo vědomě MIGRATE_TLS_INSECURE=1 (TLS bez ověření řetězu).",
      );
  } else if (["verify-ca", "verify-full"].includes(mode)) {
    ssl = ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true };
  } else {
    fail("MIGRATE_DATABASE_URL: neznámá hodnota sslmode");
  }
  return {
    host,
    port: url.port ? Number(url.port) : undefined,
    user: user || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || undefined,
    ssl,
    application_name: "se-vezmou-migrate",
    connectionTimeoutMillis: 15_000,
  };
}

async function tableExists(client, schema, table) {
  const r = await client.query("select to_regclass($1) is not null as e", [`${schema}.${table}`]);
  return r.rows[0].e;
}

/**
 * Zjistí stav: co je aplikováno, co čeká, co se liší. Jen čte (pro --dry-run a --status).
 * Vrací { applied: Map(version -> row), rows: [...], problems: [string] }.
 */
export async function inspect(client, migrations) {
  const problems = [];
  const hasSchema = (
    await client.query(
      "select exists (select 1 from pg_namespace where nspname = 'se_vezmou') as e",
    )
  ).rows[0].e;
  const tracked = hasSchema && (await tableExists(client, "se_vezmou", "schema_migrations"));

  const roles = await client.query(
    "select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')",
  );
  const missingRoles = ["anon", "authenticated", "service_role"].filter(
    (r) => !roles.rows.some((x) => x.rolname === r),
  );
  if (missingRoles.length) {
    problems.push(
      `V databázi chybí role ${missingRoles.join(", ")} (platforma Supabase). Je to opravdu projekt Supabase?`,
    );
  }

  if (hasSchema) {
    const me = await client.query(
      `select current_user as u,
              (select rolsuper from pg_roles where rolname = current_user) as su,
              pg_has_role(current_user, (select nspowner from pg_namespace where nspname = 'se_vezmou'), 'member') as owner`,
    );
    const { u, su, owner } = me.rows[0];
    if (!su && !owner) {
      problems.push(
        `Role ${u} není vlastníkem schématu se_vezmou (ani superuživatel). Použijte roli, která provedla ` +
          "supabase/init/00_init_se_vezmou.sql (role postgres).",
      );
    }
  }

  const applied = new Map();
  if (tracked) {
    const r = await client.query(
      "select version, name, checksum, applied_at from se_vezmou.schema_migrations order by version",
    );
    for (const row of r.rows) applied.set(row.version, row);
  } else if (hasSchema) {
    const n = (
      await client.query(
        "select count(*)::int as n from pg_class where relnamespace = 'se_vezmou'::regnamespace and relkind in ('r', 'p')",
      )
    ).rows[0].n;
    if (n > 0) {
      problems.push(
        `Schéma se_vezmou už obsahuje ${n} tabulek, ale chybí evidence se_vezmou.schema_migrations. ` +
          "Nástroj nic nepřepisuje: stav neodpovídá očekávání (databáze nevznikla tímto nástrojem).",
      );
    }
  }

  const local = new Map(migrations.map((m) => [m.version, m]));
  const rows = [];
  let latestApplied = "";
  for (const [version, row] of applied) {
    if (version > latestApplied) latestApplied = version;
    const m = local.get(version);
    if (!m) {
      rows.push({ version, name: row.name, state: "chybí v repozitáři" });
      problems.push(`Migrace ${version}_${row.name} je aplikovaná, ale v repozitáři chybí.`);
    } else if (m.checksum !== row.checksum) {
      rows.push({ version, name: m.name, state: "ZMĚNĚNA po aplikaci" });
      problems.push(
        `Migrace ${m.file} se po aplikaci změnila (checksum ${row.checksum.slice(0, 12)}… v databázi, ` +
          `${m.checksum.slice(0, 12)}… v souboru). Aplikovanou migraci neupravujte, přidejte novou.`,
      );
    } else {
      rows.push({ version, name: m.name, state: "aplikována", appliedAt: row.applied_at });
    }
  }
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    if (m.version < latestApplied) {
      rows.push({ version: m.version, name: m.name, state: "čeká, ale je starší než aplikované" });
      problems.push(
        `Migrace ${m.file} je starší než už aplikovaná ${latestApplied}. Pořadí se nesmí měnit, dejte jí novou verzi.`,
      );
    } else {
      rows.push({ version: m.version, name: m.name, state: "čeká" });
    }
  }
  rows.sort((a, b) => (a.version < b.version ? -1 : 1));
  return { applied, rows, problems, hasSchema, tracked };
}

function printRows(rows, log) {
  for (const r of rows) {
    const when = r.appliedAt ? ` (${new Date(r.appliedAt).toISOString()})` : "";
    log(`  ${r.version}_${r.name}: ${r.state}${when}`);
  }
}

async function ensureTracking(client) {
  await client.query(`
    create schema if not exists se_vezmou;
    create table if not exists se_vezmou.schema_migrations (
      version text primary key,
      name text not null,
      checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz not null default now()
    );
    alter table se_vezmou.schema_migrations enable row level security;
    revoke all on se_vezmou.schema_migrations from public, anon, authenticated, service_role;
  `);
}

async function applyOne(client, m, log) {
  await client.query("begin");
  try {
    await client.query("set local lock_timeout = '30s'");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [LOCK_KEY]);
    const already = await client.query(
      "select 1 from se_vezmou.schema_migrations where version = $1",
      [m.version],
    );
    if (already.rowCount) {
      await client.query("rollback");
      log(`  ${m.file}: už aplikována jiným během, přeskakuji`);
      return false;
    }
    await client.query(m.sql);
    await client.query(
      "insert into se_vezmou.schema_migrations (version, name, checksum) values ($1, $2, $3)",
      [m.version, m.name, m.checksum],
    );
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

export async function run(
  argv,
  env = process.env,
  io = { log: console.log, error: console.error },
) {
  const opts = parseArgs(argv);
  if (opts.help) {
    io.log(
      "Použití: npm run db:migrate -- [--dry-run | --status] [--dir <adresář>]\nPotřebuje MIGRATE_DATABASE_URL.",
    );
    return 0;
  }
  const rawUrl = (env.MIGRATE_DATABASE_URL ?? "").trim();
  if (!rawUrl) {
    fail(
      "Chybí MIGRATE_DATABASE_URL (spojení vlastníka, role postgres, přímé nebo session pooler na portu 5432). " +
        "Postup: supabase/README.md.",
    );
  }
  const migrations = loadMigrations(opts.dir);
  if (migrations.length === 0) fail(`V ${opts.dir} nejsou žádné migrace`);
  const config = clientConfig(rawUrl, env);

  const client = new pg.Client(config);
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch (error) {
    fail(
      `Nepodařilo se připojit k databázi (${error.code ?? "bez kódu"}): ${error.message}`.replace(
        config.password ?? "\u0000",
        "***",
      ),
    );
  }
  try {
    const target = `${config.host ?? "(socket)"}:${config.port ?? 5432}/${config.database ?? ""} jako ${config.user ?? "?"}`;
    io.log(`Databáze: ${target}`);
    const state = await inspect(client, migrations);

    if (opts.status) {
      printRows(state.rows, io.log);
      if (state.problems.length) {
        state.problems.forEach((p) => io.error(`PROBLÉM: ${p}`));
        return 1;
      }
      io.log(
        `Aplikováno ${state.applied.size} z ${migrations.length}, čeká ${state.rows.filter((r) => r.state === "čeká").length}.`,
      );
      return 0;
    }

    if (state.problems.length) {
      printRows(state.rows, io.log);
      state.problems.forEach((p) => io.error(`PROBLÉM: ${p}`));
      io.error("Nic se nespustilo.");
      return 1;
    }

    const pending = migrations.filter((m) => !state.applied.has(m.version));
    for (const m of pending) {
      const bad = destructiveStatement(m.sql);
      if (bad) {
        fail(
          `Migrace ${m.file} obsahuje destruktivní příkaz (${bad}…). Nástroj nikdy nemaže data ani objekty, nic se nespustilo.`,
        );
      }
    }

    if (pending.length === 0) {
      io.log("Nic k aplikování: databáze je aktuální.");
      return 0;
    }

    if (opts.dryRun) {
      io.log(`Plán (--dry-run, nic se nezapíše): ${pending.length} migrací`);
      for (const m of pending) io.log(`  ${m.file}  sha256 ${m.checksum.slice(0, 16)}…`);
      return 0;
    }

    await ensureTracking(client);
    let done = 0;
    for (const m of pending) {
      io.log(`  aplikuji ${m.file}`);
      try {
        if (await applyOne(client, m, io.log)) done++;
      } catch (error) {
        fail(
          `Migrace ${m.file} selhala a byla vrácena zpět (${error.code ?? "bez kódu"}): ${error.message}`,
        );
      }
    }
    io.log(`Hotovo: aplikováno ${done} migrací.`);
    return 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof MigrateError ? `CHYBA: ${error.message}` : error);
      process.exit(1);
    });
}
