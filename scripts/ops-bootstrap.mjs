#!/usr/bin/env node
// Založení prvního operátora (majitele) a obnova jeho druhého faktoru (docs/adr/0012, supabase/README.md).
//
//   export MIGRATE_DATABASE_URL='postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres'
//   npm run ops:create-owner -- majitel@example.cz       # založí majitele (jen když ještě žádný není)
//   npm run ops:create-owner -- druhy@example.cz --allow-additional
//   npm run ops:reset-mfa -- majitel@example.cz          # zneplatní druhý faktor a záložní kódy, ukončí relace
//
// Proč skript a ne veřejná cesta: operátoři se nesmějí zaregistrovat sami. Ostatní operátory zakládá majitel
// v administraci (/operatori), ale PRVNÍ musí vzniknout mimo aplikaci, spojením vlastníka databáze. Žádné
// heslo ani klíč se nikam nezapisuje a nevypisuje: operátor se přihlašuje kódem z e-mailu a při prvním
// přihlášení si zapíše druhý faktor (TOTP). Skript zapíše záznam do auditu (aktér `system`, bez e-mailu).
//
// MIGRATE_DATABASE_URL je stejné spojení vlastníka jako u `npm run db:migrate` (role postgres, přímé spojení
// nebo session pooler na portu 5432; aplikační roli a port 6543 odmítne). Databáze musí mít aplikované migrace.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";
import { clientConfig, MigrateError } from "./db-migrate.mjs";

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;

function fail(message) {
  throw new MigrateError(message);
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, email: undefined, allowAdditional: false, help: false };
  if (command === "--help" || command === "-h" || command === undefined) opts.help = true;
  for (const a of rest) {
    if (a === "--allow-additional") opts.allowAdditional = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a.startsWith("--")) fail(`Neznámý argument: ${a}`);
    else if (opts.email === undefined) opts.email = a;
    else fail("Zadejte jen jeden e-mail");
  }
  if (!opts.help && command !== "create-owner" && command !== "reset-mfa") {
    fail(`Neznámý příkaz: ${command}. Použijte create-owner nebo reset-mfa.`);
  }
  if (!opts.help) {
    const email = (opts.email ?? "").trim().toLowerCase();
    if (!email || email.length > 254 || !EMAIL_RE.test(email))
      fail("Zadejte platný e-mail operátora.");
    opts.email = email;
  }
  if (opts.allowAdditional && opts.command !== "create-owner") {
    fail("--allow-additional patří jen k create-owner");
  }
  return opts;
}

const USAGE = `Použití:
  npm run ops:create-owner -- <e-mail> [--allow-additional]
  npm run ops:reset-mfa -- <e-mail>

Spojení vlastníka databáze se bere z MIGRATE_DATABASE_URL (jako u npm run db:migrate).`;

/** Ověří, že migrace M9 jsou aplikované (jinak by skript nemělo do čeho zapisovat). */
async function assertMigrated(client) {
  const r = await client.query(
    `select exists (select 1 from information_schema.columns
                     where table_schema = 'se_vezmou' and table_name = 'operators'
                       and column_name = 'totp_confirmed_at') as ok`,
  );
  if (!r.rows[0].ok) {
    fail("V databázi chybí migrace provozní administrace. Nejdřív spusťte `npm run db:migrate`.");
  }
}

export async function createOwner(client, { email, allowAdditional }) {
  await assertMigrated(client);
  await client.query("begin");
  try {
    const existing = await client.query(
      "select 1 from se_vezmou.operators where lower(email::text) = $1",
      [email],
    );
    if (existing.rowCount > 0) fail("Operátor s tímto e-mailem už existuje.");
    const owners = await client.query(
      "select count(*)::int as n from se_vezmou.operators where role = 'owner' and disabled_at is null",
    );
    if (owners.rows[0].n > 0 && !allowAdditional) {
      fail(
        "Aktivní majitel už existuje. Další operátory zakládá majitel v administraci (/operatori). " +
          "Chcete-li přesto založit dalšího majitele tímto skriptem, přidejte --allow-additional.",
      );
    }
    const inserted = await client.query(
      "insert into se_vezmou.operators (email, role) values ($1, 'owner') returning id",
      [email],
    );
    const id = inserted.rows[0].id;
    await client.query(
      "select se_vezmou.write_audit('system', null, null, 'operator.bootstrap', 'operator', $1, null, $2::jsonb)",
      [id, JSON.stringify({ role: "owner", additional: owners.rows[0].n > 0 })],
    );
    await client.query("commit");
    return id;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

export async function resetMfa(client, { email }) {
  await assertMigrated(client);
  await client.query("begin");
  try {
    const found = await client.query(
      "select id from se_vezmou.operators where lower(email::text) = $1 for update",
      [email],
    );
    if (found.rowCount === 0) fail("Operátor s tímto e-mailem neexistuje.");
    const id = found.rows[0].id;
    await client.query(
      "update se_vezmou.operators set totp_secret_enc = null, totp_confirmed_at = null, totp_last_step = null where id = $1",
      [id],
    );
    await client.query("delete from se_vezmou.operator_backup_codes where operator_id = $1", [id]);
    await client.query(
      "update se_vezmou.operator_sessions set revoked_at = now() where operator_id = $1 and revoked_at is null",
      [id],
    );
    await client.query(
      "select se_vezmou.write_audit('system', null, null, 'operator.mfa_reset', 'operator', $1, $2, '{}'::jsonb)",
      [id, "Obnova druhého faktoru skriptem majitele databáze"],
    );
    await client.query("commit");
    return id;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const url = process.env.MIGRATE_DATABASE_URL?.trim();
  if (!url) {
    fail(
      "Chybí MIGRATE_DATABASE_URL: spojení vlastníka databáze (role postgres), stejné jako pro npm run db:migrate.",
    );
  }
  const client = new pg.Client(clientConfig(url));
  await client.connect();
  try {
    if (opts.command === "create-owner") {
      const id = await createOwner(client, opts);
      console.log(`Majitel byl založen (identifikátor ${id}).`);
      console.log("Dál: otevřete administraci (admin.<doména>/prihlaseni), zadejte tento e-mail,");
      console.log(
        "opište kód z e-mailu a zapište druhý faktor (aplikace TOTP). Záložní kódy si uložte.",
      );
    } else {
      const id = await resetMfa(client, opts);
      console.log(`Druhý faktor operátora ${id} byl zneplatněn a jeho relace ukončeny.`);
      console.log("Při dalším přihlášení si zapíše nový faktor.");
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof MigrateError ? `CHYBA: ${error.message}` : error);
    process.exit(1);
  });
}
