#!/usr/bin/env node
// Trvalý, plně vyplněný DEMO web „Test a Test“ (docs/demo-web.md). Opakovaně spustitelný:
//
//   npm run demo:seed -- --yes                 # založí, nebo aktualizuje demo (výchozí adresa test-a-test)
//   npm run demo:seed -- --reset --yes         # smaže obsah dema a založí ho znovu
//   npm run demo:seed -- --delete --yes        # demo smaže (jako „Smazat web“ ve správě)
//   npm run demo:seed -- --help
//
// Jak funguje a proč tak (rozhodnutí z docs/demo-web.md):
//  * Skript NEPÍŠE do tabulek. Volá stejné funkce `security definer` jako aplikace, se stejnými claimy
//    transakce (role `service_role` před přihlášením, role `authenticated` + claimy správce nebo hosta pro
//    svatbu), takže platí všechny invarianty: hashe PINů (argon2id s PIN_PEPPER), lhůty retence, audit,
//    kontroly snímku webu, omezení počtů a práva. Spojení vlastníka (jako db:migrate) slouží jen k tomu,
//    aby se mohla přepnout role; přímý SQL zápis je jen pro dva úzké případy (obnova smazaného dema,
//    úklid odpovědí hostů mimo seznam při --reset), oba se zapíší do auditu.
//  * Neodesílá žádné e-maily a nevolá SES: databázové funkce e-maily neposílají (posílá je aplikace),
//    oznámení provozovateli „Nový web“ vzniká jen v aplikaci při dokončení průvodce, který se tu nepoužívá.
//  * Spojení: MIGRATE_DATABASE_URL (vlastník schématu, session pooler 5432) a MIGRATE_CA_CERT, přesně jako
//    `npm run db:migrate` (scripts/db-migrate.mjs). PIN_PEPPER musí být stejná hodnota jako na Vercelu,
//    jinak by PIN neodpovídal hashi, který ověřuje aplikace.
//  * Proti vzdálené databázi odmítne běžet bez výslovného --yes; vypíše, co udělá (host bez hesla).
//  * PINy: z DEMO_GUEST_PIN / DEMO_SITE_PIN (nebo --guest-pin / --site-pin), jinak se vygenerují a vypíšou
//    jedinkrát na konzoli (nikdy do souboru). S --require-pins (CI) chybějící PIN skončí chybou.
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";
import { clientConfig, MigrateError } from "./db-migrate.mjs";

const DEFAULT_SLUG = "test-a-test";
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ANONYMOUS_SUB = "00000000-0000-0000-0000-000000000000";

function fail(message) {
  throw new MigrateError(message);
}

const USAGE = `Použití:
  npm run demo:seed -- [--yes] [--reset | --delete] [volby]

Režimy:
  (výchozí)   založí demo, nebo ho aktualizuje na místě (idempotentní)
  --reset     smaže obsah dema (hosté, odpovědi, dary, dodavatelé, poznámky, fotografie) a založí ho znovu
  --delete    demo smaže jako „Smazat web“ ve správě (adresa zůstane trvale zabraná, viz docs/demo-web.md)

Volby:
  --slug <adresa>            výchozí ${DEFAULT_SLUG}
  --admin-email <e-mail>     správce (majitel), nebo DEMO_ADMIN_EMAIL
  --date <datum>             datum svatby: auto (dnes + 1 rok, sobota), +2y, +18m, nebo RRRR-MM-DD
  --template <klíč>          šablona (výchozí louka)
  --palette <klíč>           paleta (výchozí levandule)
  --guest-pin <PIN>          PIN hostů (odemyká web), nebo DEMO_GUEST_PIN; jinak se vygeneruje
  --site-pin <PIN>           PIN správy webu, nebo DEMO_SITE_PIN; jinak se vygeneruje
  --rotate-pins              u existujícího dema vygeneruje a nastaví nové PINy
  --require-pins             PINy musí přijít z prostředí (CI): nic se negeneruje ani nevypisuje
  --no-photos                fotografie nenahrávej (ani když jsou R2 proměnné)
  --yes                      potvrzení běhu proti vzdálené databázi
  --help

Prostředí: MIGRATE_DATABASE_URL, MIGRATE_CA_CERT (nebo MIGRATE_CA_CERT_FILE), PIN_PEPPER (stejný jako na
Vercelu), volitelně R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (fotografie).`;

// --- argumenty ----------------------------------------------------------------------------------

const VALUE_FLAGS = {
  "--slug": "slug",
  "--admin-email": "adminEmail",
  "--date": "date",
  "--template": "template",
  "--palette": "palette",
  "--guest-pin": "guestPin",
  "--site-pin": "sitePin",
};
const BOOL_FLAGS = {
  "--yes": "yes",
  "--reset": "reset",
  "--delete": "delete",
  "--rotate-pins": "rotatePins",
  "--require-pins": "requirePins",
  "--no-photos": "noPhotos",
  "--help": "help",
  "-h": "help",
};

/**
 * Parametry z příkazové řádky a prostředí. Hodnoty z prostředí jsou jen výchozí, volba je přepíše.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 */
export function parseArgs(argv, env = process.env) {
  const opts = {
    slug: DEFAULT_SLUG,
    adminEmail: (env.DEMO_ADMIN_EMAIL ?? "").trim() || undefined,
    date: undefined,
    template: undefined,
    palette: undefined,
    guestPin: (env.DEMO_GUEST_PIN ?? "").trim() || undefined,
    sitePin: (env.DEMO_SITE_PIN ?? "").trim() || undefined,
    yes: false,
    reset: false,
    delete: false,
    rotatePins: false,
    requirePins: false,
    noPhotos: false,
    help: false,
    /** @type {"seed" | "reset" | "delete"} */
    mode: "seed",
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq > 0) {
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    if (arg in BOOL_FLAGS) {
      if (inline !== undefined) fail(`${arg} nemá hodnotu`);
      opts[BOOL_FLAGS[arg]] = true;
    } else if (arg in VALUE_FLAGS) {
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith("--")) fail(`${arg} vyžaduje hodnotu`);
      opts[VALUE_FLAGS[arg]] = value.trim();
    } else {
      fail(`Neznámý argument: ${arg}`);
    }
  }
  if (opts.help) return opts;

  if (opts.reset && opts.delete) fail("--reset a --delete nelze kombinovat");
  opts.slug = opts.slug.toLowerCase();
  if (!SLUG_RE.test(opts.slug) || opts.slug.includes("--")) {
    fail(`Neplatná adresa webu: ${opts.slug}`);
  }
  if (opts.adminEmail !== undefined) {
    opts.adminEmail = opts.adminEmail.toLowerCase();
    if (opts.adminEmail.length > 254 || !EMAIL_RE.test(opts.adminEmail)) {
      fail("Neplatný e-mail správce (--admin-email, DEMO_ADMIN_EMAIL).");
    }
  }
  opts.mode = opts.delete ? "delete" : opts.reset ? "reset" : "seed";
  if (opts.mode !== "delete" && !opts.adminEmail) {
    fail(
      "Chybí e-mail správce: --admin-email nebo DEMO_ADMIN_EMAIL (majitel, který web spravuje).",
    );
  }
  if (opts.guestPin && opts.sitePin && opts.guestPin === opts.sitePin) {
    fail("PIN hostů a PIN správy musí být různé.");
  }
  return opts;
}

// --- ochrana ------------------------------------------------------------------------------------

const LOOPBACK = new Set(["", "localhost", "127.0.0.1", "[::1]", "::1"]);

/** Míří spojení mimo tento počítač? (loopback a unixový socket jsou lokální.) */
export function isRemoteConfig(config) {
  const host = config.host ?? "";
  return !(LOOPBACK.has(host) || host.startsWith("/"));
}

/** Popis cíle pro výpis: host, port a databáze, nikdy uživatel s heslem. */
export function describeTarget(config, { hideHost = false } = {}) {
  if (hideHost)
    return `${isRemoteConfig(config) ? "vzdálená" : "lokální"} databáze (host skrytý v logu CI)`;
  const host =
    config.host && config.host.startsWith("/")
      ? "unixový socket"
      : (config.host ?? "lokální socket");
  return `${host}${config.port ? `:${config.port}` : ""}/${config.database ?? ""}`;
}

/** Vzdálená databáze jen s výslovným --yes. */
export function assertSafeTarget(config, opts) {
  if (isRemoteConfig(config) && !opts.yes) {
    fail(
      `Cílem je vzdálená databáze (${describeTarget(config, { hideHost: process.env.GITHUB_ACTIONS === "true" })}). Pro běh proti ní přidejte --yes ` +
        "(skript předtím vypíše, co udělá, a nic nespustí bez potvrzení).",
    );
  }
}

/** Text, který skript vypíše před jakoukoli změnou. */
export function planLines(opts, config, { hideHost = false } = {}) {
  const what = {
    seed: "založí, nebo aktualizuje demo web (kompletní obsah v cs i en, hosté, odpovědi, dary, dodavatelé, zasedací pořádek)",
    reset:
      "SMAŽE obsah dema (hosté, odpovědi, dary, dodavatelé, poznámky, fotografie) a založí ho znovu",
    delete: "SMAŽE demo web (jako „Smazat web“ ve správě)",
  }[opts.mode];
  return [
    `Databáze: ${describeTarget(config, { hideHost })}${hideHost ? "" : isRemoteConfig(config) ? " (vzdálená)" : " (lokální)"}`,
    `Web: ${opts.slug}`,
    `Akce: ${what}`,
    opts.mode === "delete" ? null : `Správce: ${opts.adminEmail}`,
    "E-maily: žádné se neodesílají, SES se nevolá.",
  ].filter(Boolean);
}

// --- volání funkcí databáze ---------------------------------------------------------------------

export class DemoError extends MigrateError {}

function bind(value) {
  if (value === undefined) return null;
  if (
    value !== null &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  ) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Jedno volání funkce `se_vezmou.<fn>` v jedné transakci, stejně jako `src/lib/db/transport.ts`:
 * `as` chybí = role service_role; jinak role authenticated a claimy { sub, wedding_id, wedding_role }.
 * Správce se před voláním ověří funkcí assert_admin_session (stále aktivní, web není zablokovaný).
 */
/**
 * @param {import("pg").ClientBase} client
 * @param {string} fn
 * @param {Record<string, unknown>} [args]
 * @param {{ as?: { sub: string, weddingId: string, role: string }, kind?: "scalar" | "table" }} [options]
 */
export async function rpc(client, fn, args = {}, { as, kind = "scalar" } = {}) {
  const names = Object.keys(args).filter((k) => args[k] !== undefined);
  const placeholders = names.map((k, i) => `${k} => $${i + 1}`).join(", ");
  const sql =
    kind === "table"
      ? `select * from se_vezmou.${fn}(${placeholders})`
      : `select se_vezmou.${fn}(${placeholders}) as v`;
  await client.query("begin");
  try {
    await client.query(`set local role ${as ? "authenticated" : "service_role"}`);
    if (as) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: as.sub, wedding_id: as.weddingId, wedding_role: as.role }),
      ]);
      if (as.role === "admin") await client.query("select se_vezmou.assert_admin_session()");
    }
    const result = await client.query(
      sql,
      names.map((k) => bind(args[k])),
    );
    await client.query("commit");
    return kind === "table" ? result.rows : (result.rows[0]?.v ?? null);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    // Zpráva funkcí je identifikátor chyby (invalid_payload, forbidden …); osobní údaje do ní nepatří.
    throw new DemoError(`${fn} selhala: ${error?.message ?? error} (${error?.code ?? "bez kódu"})`);
  }
}

const adminOf = (weddingId, adminId) => ({ sub: adminId, weddingId, role: "admin" });
const visitorOf = (weddingId) => ({ sub: ANONYMOUS_SUB, weddingId, role: "visitor" });

// --- knihovny aplikace (TypeScript, spouští je tsx) ----------------------------------------------

export async function loadLibs() {
  const [content, doc, pin, media, mediaTypes, process, r2, storageTypes, seating, limits] =
    await Promise.all([
      import("./demo-seed-content.ts"),
      import("../src/admin/site/doc.ts"),
      import("../src/auth/pin.ts"),
      import("../src/lib/media/types.ts"),
      import("../src/lib/media/limits.ts"),
      import("../src/lib/media/process.ts"),
      import("../src/lib/storage/r2.ts"),
      import("../src/lib/storage/types.ts"),
      import("../src/admin/seating/layout.ts"),
      import("../src/auth/pin-format.ts"),
    ]);
  return { content, doc, pin, media, mediaTypes, process, r2, storageTypes, seating, limits };
}

// --- běh ----------------------------------------------------------------------------------------

async function findWedding(client, slug) {
  const r = await client.query(
    "select id, status, slug from se_vezmou.weddings where slug = $1 order by created_at desc limit 1",
    [slug],
  );
  return r.rows[0] ?? null;
}

async function activeAdmins(client, weddingId) {
  const r = await client.query(
    "select id, email::text as email from se_vezmou.wedding_admins where wedding_id = $1 and removed_at is null order by added_at",
    [weddingId],
  );
  return r.rows;
}

async function assertMigrated(client) {
  const r = await client.query(
    "select to_regprocedure('se_vezmou.admin_site_lock_set(boolean)') is not null as ok",
  );
  if (!r.rows[0].ok) {
    fail("V databázi chybí migrace (admin_site_lock_set). Nejdřív spusťte `npm run db:migrate`.");
  }
}

/**
 * Hlavní postup. `deps`: { client, opts, env, log, storage, libs, now, pins }.
 * `storage` je úložiště fotografií (R2 nebo v testech paměť), nebo null = fotografie se vynechají.
 * Vrací souhrn { weddingId, adminId, startsOn, created, pins: { guest, site, generated }, photos }.
 */
export async function runDemo(deps) {
  const { client, opts, log, libs } = deps;
  const { content, doc: docLib } = libs;
  await assertMigrated(client);

  let wedding = await findWedding(client, opts.slug);

  if (opts.mode === "delete") {
    return deleteDemo(deps, wedding);
  }

  const startsOn = content.resolveWeddingDate(opts.date, deps.now);
  let created = false;

  if (wedding && (wedding.status === "deleted" || wedding.status === "archived")) {
    await restoreWedding(client, wedding, log);
    wedding = { ...wedding, status: "published" };
  } else if (wedding && wedding.status === "blocked") {
    fail("Demo web je zablokovaný provozovatelem (stav blocked). Odblokujte ho v administraci.");
  }

  // PINy: z prostředí, nebo vygenerované (jen u nového dema, --rotate-pins, nebo když chybí hash)
  const hasHashes = wedding
    ? (
        await client.query(
          "select guest_pin_hash is not null as g, admin_pin_hash is not null as a from se_vezmou.wedding_auth where wedding_id = $1",
          [wedding.id],
        )
      ).rows[0]
    : null;
  const pins = { guest: opts.guestPin, site: opts.sitePin, generated: [] };
  const need = (given, has) => Boolean(given) || !wedding || opts.rotatePins || !has;
  const setGuest = need(opts.guestPin, hasHashes?.g);
  const setSite = need(opts.sitePin, hasHashes?.a);
  for (const [kind, set] of [
    ["guest", setGuest],
    ["site", setSite],
  ]) {
    if (!set) continue;
    if (!pins[kind]) {
      if (opts.requirePins) {
        fail(
          `Chybí ${kind === "guest" ? "DEMO_GUEST_PIN" : "DEMO_SITE_PIN"}: s --require-pins se PIN negeneruje ` +
            "(vypsal by se do logu).",
        );
      }
      pins[kind] = content.generatePin();
      pins.generated.push(kind);
    }
    const problem = libs.limits.pinProblem(pins[kind]);
    if (problem)
      fail(
        `PIN ${kind === "guest" ? "hostů" : "správy"} není platný (${problem}): nejméně šest číslic, ne triviální.`,
      );
  }
  if (pins.guest && pins.site && pins.guest === pins.site) {
    fail("PIN hostů a PIN správy musí být různé.");
  }
  const pepper = (deps.env.PIN_PEPPER ?? "").trim();
  if ((setGuest || setSite) && pepper.length < 32) {
    fail(
      "Chybí PIN_PEPPER (min. 32 znaků, stejná hodnota jako na Vercelu), bez ní PIN neodpovídá ověření aplikace.",
    );
  }

  let adminId;
  // 1. nové demo: svatba, správce, záložní e-mail a zakázka (stejná funkce jako první uložení v průvodci)
  if (!wedding) {
    const draft0 = content.buildDoc({
      slug: opts.slug,
      startsOn,
      template: opts.template,
      palette: opts.palette,
    });
    const work = {
      ...docLib.docToWork(draft0),
      rsvp: {
        opensAt: null,
        closesAt: null,
        allowUnlisted: true,
        emailConfirmation: true,
        questions: {},
      },
    };
    work.wedding = { ...work.wedding, guestPinEnabled: true };
    const createSlug = await chooseCreateSlug(client, opts.slug, log);
    const rows = await rpc(
      client,
      "wizard_create_draft",
      {
        p_email: opts.adminEmail,
        p_backup_email: content.BACKUP_EMAIL,
        p_slug: createSlug,
        p_draft: {},
        p_work: work,
      },
      { kind: "table" },
    );
    const row = rows[0];
    if (!row?.ok) {
      fail(
        `Adresu ${opts.slug} nejde přidělit (je zabraná, rezervovaná nebo trvale uvolněná po dřívějším smazání dema). ` +
          `Zvolte jiné --slug. Návrhy: ${(row?.variants ?? []).join(", ") || "žádné"}.`,
      );
    }
    wedding = { id: row.wedding_id, status: "draft", slug: opts.slug };
    adminId = row.admin_id;
    created = true;
    if (createSlug !== opts.slug)
      await assignReservedWordSlug(client, wedding.id, createSlug, opts.slug);
    log(`Založena svatba ${opts.slug}.`);

    await setPins(
      client,
      wedding.id,
      adminId,
      pins,
      { setGuest: true, setSite: true },
      pepper,
      libs,
    );
    // první zveřejnění (draft -> published) stejnou funkcí jako průvodce
    const built = docLib.docToPublic(draft0, {
      slug: opts.slug,
      quickNotice: content.QUICK_NOTICE,
      media: [],
    });
    if (!built) fail("Snímek webu nejde sestavit (docToPublic).");
    await rpc(
      client,
      "publish_site",
      {
        p_wedding_id: wedding.id,
        p_actor_admin_id: adminId,
        p_public_content: built.content,
        p_sensitive: built.sensitive,
      },
      { kind: "table" },
    );
    log("Web zveřejněn (první verze).");
  } else {
    const admins = await activeAdmins(client, wedding.id);
    if (admins.length === 0) fail("Demo web nemá žádného aktivního správce.");
    adminId = (admins.find((a) => a.email === opts.adminEmail) ?? admins[0]).id;
    if (!admins.some((a) => a.email === opts.adminEmail)) {
      await addAdmin(client, wedding.id, adminId, opts.adminEmail, log);
    }
  }
  const as = adminOf(wedding.id, adminId);

  // 2. reset: smazat obsah (po zakladateli, aby se zakládalo na čisto)
  if (opts.mode === "reset" && !created) {
    await wipeContent(deps, wedding.id, as);
  }

  // 3. přístup: PINy, druhý správce, zámek webu
  if (!created) {
    await setPins(client, wedding.id, adminId, pins, { setGuest, setSite }, pepper, libs);
  }
  await addAdmin(client, wedding.id, adminId, content.SECOND_ADMIN_EMAIL, log);
  await rpc(client, "admin_guest_pin_enabled_set", { p_enabled: true }, { as });
  await rpc(client, "admin_site_lock_set", { p_locked: true }, { as });
  await rpc(client, "admin_rsvp_notify_set", { p_enabled: false }, { as });

  // 4. RSVP: nastavení a vlastní otázky (id existujících otázek se zachovají, ať se upravují, ne zakládají znovu)
  const current = await rpc(client, "admin_rsvp_settings_get", {}, { as });
  const idByKey = new Map((current?.questions ?? []).map((q) => [q.key, q.id]));
  const settings = content.buildRsvpSettings(opts.slug, startsOn);
  settings.questions = settings.questions.map((q) => {
    const id = idByKey.get(q.key);
    if (!id) return q;
    const rest = { ...q };
    delete rest.key;
    return { id, ...rest };
  });
  // události musí v databázi být dřív než otázka k události: pracovní kopie se ukládá nejdřív (krok 5),
  // proto nastavení RSVP s otázkami následuje po uložení webu
  // 5. fotografie, uložení pracovní kopie a zveřejnění
  const photos = await syncPhotos(deps, wedding.id, as);
  const doc = content.buildDoc({
    slug: opts.slug,
    startsOn,
    template: opts.template,
    palette: opts.palette,
    photoIds: photos.ids,
  });
  const loaded = await rpc(client, "admin_site_load", {}, { as });
  const saved = await rpc(
    client,
    "admin_site_save",
    { p_base_rev: loaded.wedding.site_rev, p_work: docLib.docToWork(doc), p_touch: true },
    { as, kind: "table" },
  );
  if (!saved[0]?.ok) fail("Uložení pracovní kopie webu se nepovedlo (konflikt revize).");
  await rpc(
    client,
    "admin_quick_notice_set",
    { p_notice: content.QUICK_NOTICE, p_enabled: true },
    { as },
  );
  await rpc(client, "admin_rsvp_settings_save", { p_payload: settings }, { as });

  // 6. hosté, odpovědi, zasedací pořádek, dary, dodavatelé, poznámky
  const stats = await seedGuests(deps, wedding.id, as, doc, startsOn);
  await seedGifts(deps, wedding.id, as);
  await seedVendors(deps, as);
  await seedNotes(deps, as);
  await seedSeating(deps, as, doc, stats);

  // 7. závěrečné zveřejnění: snímek se sestaví z uložené kopie a hotových médií, jako to dělá správa
  const media = photos.items;
  const reconciled = docLib.reconcileGalleryMedia(doc, media);
  const issues = docLib.validateDoc(reconciled, { guestPinReady: true, media });
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0)
    fail(`Obsah dema neprošel kontrolou: ${errors.map((i) => i.code).join(", ")}`);
  const after = await rpc(client, "admin_site_load", {}, { as });
  const built = docLib.docToPublic(reconciled, {
    slug: opts.slug,
    quickNotice: content.QUICK_NOTICE,
    media,
  });
  if (!built) fail("Snímek webu nejde sestavit (docToPublic).");
  const published = await rpc(
    client,
    "admin_site_publish",
    {
      p_public: built.content,
      p_sensitive: built.sensitive,
      p_note: "Demo web (scripts/demo-seed.mjs)",
      p_base_rev: after.wedding.site_rev,
    },
    { as, kind: "table" },
  );
  if (!published[0]?.ok) fail("Zveřejnění dema selhalo (konflikt revize).");
  log(`Web zveřejněn (verze ${published[0].version_no}).`);

  await client.query(
    "select se_vezmou.write_audit('system', null, $1, 'demo.seed', 'wedding', $1, 'scripts/demo-seed.mjs', $2::jsonb)",
    [wedding.id, JSON.stringify({ mode: opts.mode, created })],
  );

  return {
    weddingId: wedding.id,
    adminId,
    startsOn,
    created,
    pins,
    photos: { count: photos.ids.length, storage: photos.storageKind },
    guests: stats,
  };
}

/**
 * Adresa s vyhrazeným slovem (typicky „test-a-test“: token „test“ je v rejstříku vyhrazených slov) nejde
 * přidělit žádnou funkcí aplikace, ani průvodcem, ani operátorem (`slug_available` ji odmítá). Je to záměrné
 * pravidlo pro adresy párů; demo je výjimka, kterou smí udělat jen vlastník databáze (tento skript). Svatba se
 * proto založí s dočasnou adresou a před prvním zveřejněním se přepne na požadovanou (viz assignReservedWordSlug).
 * Adresa, kterou něco jiného blokuje (zabraná, uvolněná po smazání), se odmítne.
 */
async function chooseCreateSlug(client, slug, log) {
  const ok = (await client.query("select se_vezmou.slug_available($1) as ok", [slug])).rows[0].ok;
  if (ok) return slug;
  const valid = (
    await client.query("select coalesce(se_vezmou.slug_valid($1), false) as ok", [slug])
  ).rows[0].ok;
  if (!valid) fail(`Adresa ${slug} není platná podle pravidel adres webů.`);
  const blocked = await client.query(
    `select 1 from se_vezmou.slug_registry sr
      where sr.slug = $1 and (sr.state in ('reserved_word', 'active')
         or (sr.state = 'reserved' and sr.reserved_until > now())
         or (sr.state = 'retired' and sr.first_published_at is not null))`,
    [slug],
  );
  if (blocked.rowCount > 0) {
    fail(
      `Adresu ${slug} nejde přidělit: je zabraná nebo trvale uvolněná po dřívějším smazání dema. Zvolte jiné --slug.`,
    );
  }
  log(
    `Adresa ${slug} obsahuje vyhrazené slovo, přidělím ji jako výjimku pro demo (jen vlastník databáze).`,
  );
  return `wd-${randomBytes(5).toString("hex")}`;
}

async function assignReservedWordSlug(client, weddingId, tempSlug, slug) {
  await client.query("begin");
  try {
    await client.query(
      `delete from se_vezmou.slug_registry sr
        where sr.slug = $1 and sr.first_published_at is null
          and ((sr.state = 'reserved' and sr.reserved_until <= now()) or sr.state = 'retired')`,
      [slug],
    );
    await client.query(
      "update se_vezmou.slug_registry set state = 'retired', reserved_until = null where slug = $1 and wedding_id = $2",
      [tempSlug, weddingId],
    );
    await client.query(
      "insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until) values ($1, 'reserved', $2, now() + interval '30 days')",
      [slug, weddingId],
    );
    await client.query("update se_vezmou.weddings set slug = $1 where id = $2", [slug, weddingId]);
    await client.query(
      "select se_vezmou.write_audit('system', null, $1, 'demo.slug_exception', 'wedding', $1, 'vyhrazené slovo v adrese dema', $2::jsonb)",
      [weddingId, JSON.stringify({ slug })],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function setPins(client, weddingId, adminId, pins, which, pepper, libs) {
  const { hashPin } = libs.pin;
  if (which.setGuest) {
    await rpc(client, "auth_pin_set", {
      p_wedding_id: weddingId,
      p_role: "guest",
      p_hash: await hashPin(pins.guest, pepper),
      p_actor_admin_id: adminId,
    });
  }
  if (which.setSite) {
    await rpc(client, "auth_pin_set", {
      p_wedding_id: weddingId,
      p_role: "admin",
      p_hash: await hashPin(pins.site, pepper),
      p_actor_admin_id: adminId,
    });
  }
}

async function addAdmin(client, weddingId, actorId, email, log) {
  // už existující správce se nepřidává znovu (funkce by hlásila admin_exists)
  if ((await activeAdmins(client, weddingId)).some((a) => a.email === email)) return;
  await rpc(client, "admin_admin_add", { p_email: email }, { as: adminOf(weddingId, actorId) });
  log(`Přidán správce${email.endsWith(".invalid") ? " (ukázkový, bez odesílání e-mailů)" : ""}.`);
}

/** Obnova smazaného nebo archivovaného dema (stav published); do auditu jako systém. */
async function restoreWedding(client, wedding, log) {
  await client.query("begin");
  try {
    await client.query("update se_vezmou.weddings set status = 'published' where id = $1", [
      wedding.id,
    ]);
    await client.query(
      "insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, reason) values ($1, $2, 'published', 'system', 'demo_restore')",
      [wedding.id, wedding.status],
    );
    await client.query(
      "select se_vezmou.write_audit('system', null, $1, 'demo.restore', 'wedding', $1, 'scripts/demo-seed.mjs', $2::jsonb)",
      [wedding.id, JSON.stringify({ from_status: wedding.status })],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
  log(`Demo bylo ve stavu ${wedding.status}, obnoveno na zveřejněné.`);
}

async function deleteDemo(deps, wedding) {
  const { client, log } = deps;
  if (!wedding || wedding.status === "deleted") {
    log("Demo web neexistuje (nebo je už smazaný), není co mazat.");
    return { weddingId: wedding?.id ?? null, deleted: false };
  }
  const admins = await activeAdmins(client, wedding.id);
  if (admins.length === 0)
    fail("Demo web nemá žádného aktivního správce, smazání přes funkci aplikace není možné.");
  const as = adminOf(wedding.id, admins[0].id);
  await deleteAllPhotos(deps, wedding.id, as);
  await rpc(client, "admin_wedding_delete", {}, { as });
  log(
    "Demo web je smazaný (nedostupný hned, trvale ho smaže noční úloha po ochranné lhůtě). Adresa zůstává trvale zabraná.",
  );
  return { weddingId: wedding.id, deleted: true };
}

// --- fotografie ---------------------------------------------------------------------------------

async function deleteAllPhotos(deps, weddingId, as) {
  const { client, storage, log } = deps;
  const rows = (await rpc(client, "admin_media_list", {}, { as })) ?? [];
  if (rows.length === 0) return;
  if (!storage) {
    log(
      `Pozor: ${rows.length} fotografií se maže jen z databáze, úložiště R2 není nastavené (soubory v něm zůstanou).`,
    );
  }
  for (const row of rows) {
    // soubory PŘED řádkem (stejně jako aplikace), selhání úložiště zastaví mazání řádku
    if (storage) await storage.deleteMedia(weddingId, row.id);
    await rpc(client, "admin_media_delete", { p_media_id: row.id }, { as });
  }
}

async function syncPhotos(deps, weddingId, as) {
  const { client, opts, storage, log, libs } = deps;
  const { content } = libs;
  const empty = { ids: [], items: [], storageKind: storage?.kind ?? "none" };
  if (opts.noPhotos) {
    log("Fotografie: vynechány (--no-photos). Galerie ukáže jen odkaz na externí galerii.");
    return empty;
  }
  if (!storage) {
    log(
      "Fotografie: VYNECHÁNY, úložiště R2 není nastavené (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET). Galerie ukáže jen odkaz na externí galerii.",
    );
    return empty;
  }
  const photos = content.DEMO_PHOTOS;
  let rows = (await rpc(client, "admin_media_list", {}, { as })) ?? [];
  const ready = rows
    .filter((r) => r.kind === "photo" && r.status === "ready")
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  let use = ready.slice(0, photos.length);
  if (use.length < photos.length) {
    // nekompletní sada: smazat a nahrát znovu
    await deleteAllPhotos(deps, weddingId, as);
    use = [];
    for (const photo of photos) {
      use.push(await uploadPhoto(deps, weddingId, as, photo));
    }
  }
  for (const [i, photo] of photos.entries()) {
    await rpc(
      client,
      "admin_media_update",
      { p_media_id: use[i].id, p_alt: photo.alt, p_decorative: false },
      { as },
    );
  }
  rows = (await rpc(client, "admin_media_list", {}, { as })) ?? [];
  const items = libs.media.parseMediaRows(rows);
  log(`Fotografie: ${use.length} (úložiště ${storage.kind}).`);
  return { ids: use.map((u) => u.id), items, storageKind: storage.kind };
}

async function uploadPhoto(deps, weddingId, as, photo) {
  const { client, storage, libs } = deps;
  const bytes = await libs.content.renderPhoto(photo);
  const requested = await rpc(
    client,
    "admin_media_request",
    { p_kind: "photo", p_mime: "image/jpeg", p_bytes: bytes.length },
    { as },
  );
  const id = requested.id;
  try {
    await rpc(client, "admin_media_begin", { p_media_id: id }, { as });
    const limits = libs.mediaTypes.MEDIA_LIMITS;
    const processed = await libs.process.processImage(bytes, {
      maxPixels: limits.maxPixels,
      widths: limits.widths,
    });
    const variants = processed.variants.map((v) => ({
      width: v.width,
      height: v.height,
      format: v.format,
      bytes: v.bytes,
      key: libs.storageTypes.variantKey(weddingId, id, v.width, v.format),
    }));
    await Promise.all(
      processed.variants.map((v, i) =>
        storage.putObject(variants[i].key, v.data, {
          contentType: v.format === "avif" ? "image/avif" : "image/webp",
          cacheControl: "private, max-age=3600",
        }),
      ),
    );
    await rpc(
      client,
      "admin_media_complete",
      {
        p_media_id: id,
        p_width: processed.width,
        p_height: processed.height,
        p_variants: JSON.stringify(variants),
      },
      { as },
    );
    return { id };
  } catch (error) {
    await storage.deleteMedia(weddingId, id).catch(() => undefined);
    await rpc(client, "admin_media_fail", { p_media_id: id, p_code: "internal" }, { as }).catch(
      () => undefined,
    );
    throw error;
  }
}

// --- obsah --------------------------------------------------------------------------------------

async function wipeContent(deps, weddingId, as) {
  const { client, log } = deps;
  const list = await rpc(client, "admin_guest_list", {}, { as });
  for (const h of list.households) {
    await rpc(client, "admin_household_delete", { p_household_id: h.id }, { as });
  }
  // odpovědi hostů mimo seznam nemají domácnost, funkce pro jejich smazání neexistuje: úzký přímý zásah
  await client.query(
    "delete from se_vezmou.rsvp_responses where wedding_id = $1 and household_id is null",
    [weddingId],
  );
  for (const g of (await rpc(client, "admin_gifts_list", {}, { as })) ?? []) {
    await rpc(client, "admin_gift_delete", { p_id: g.id }, { as });
  }
  for (const v of (await rpc(client, "admin_vendors_list", {}, { as })) ?? []) {
    await rpc(client, "admin_vendor_delete", { p_id: v.id }, { as });
  }
  const notes = await rpc(client, "admin_notes_get", {}, { as });
  await rpc(client, "admin_notes_save", { p_body: "", p_rev: notes.rev }, { as });
  const seating = await rpc(client, "admin_seating_get", {}, { as });
  await rpc(client, "admin_seating_save", { p_plan: {}, p_rev: seating.rev }, { as });
  await deleteAllPhotos(deps, weddingId, as);
  log("Obsah dema smazán, zakládám znovu.");
}

async function seedGuests(deps, weddingId, as, doc, startsOn) {
  const { client, opts, log, libs } = deps;
  const { content } = libs;
  const slug = opts.slug;
  const ev = {
    ceremony: content.demoId(slug, "event-ceremony"),
    dinner: content.demoId(slug, "event-dinner"),
    party: content.demoId(slug, "event-party"),
  };
  let list = await rpc(client, "admin_guest_list", {}, { as });
  const existing = new Map(list.households.map((h) => [h.label, h]));
  for (const h of content.DEMO_HOUSEHOLDS) {
    const found = existing.get(h.label);
    const byName = new Map((found?.guests ?? []).map((g) => [g.display_name, g.id]));
    const payload = {
      label: h.label,
      note: h.note ?? null,
      tags: h.tags,
      guests: h.people.map((p) => ({
        ...(byName.has(p.name) ? { id: byName.get(p.name) } : {}),
        display_name: p.name,
        is_child: Boolean(p.child),
        age: p.child ? (p.age ?? null) : null,
        invited_event_ids: h.events.map((k) => ev[k]),
      })),
    };
    await rpc(
      client,
      "admin_household_save",
      { p_household_id: found?.id ?? null, p_payload: payload },
      { as },
    );
  }
  list = await rpc(client, "admin_guest_list", {}, { as });
  const byLabel = new Map(list.households.map((h) => [h.label, h]));

  // odpovědi odesílá „host“ osobním odkazem, jako v produkci (lístek z kódu domácnosti a rsvp_submit)
  const visitor = visitorOf(weddingId);
  let answered = 0;
  for (const h of content.DEMO_HOUSEHOLDS) {
    if (!h.response) continue;
    const row = byLabel.get(h.label);
    const ticket = await rpc(
      client,
      "rsvp_invite_ticket",
      { p_code: row.invite_code },
      { as: visitor },
    );
    if (!ticket) fail("Osobní odkaz domácnosti nevydal lístek (RSVP není otevřené?).");
    const attendanceOf = (attends, kinds) =>
      kinds.map((k) => ({ event_id: ev[k], attending: Boolean(attends?.[k]) }));
    const people = h.people.map((p) => ({
      guest_id: row.guests.find((g) => g.display_name === p.name).id,
      attendance: attendanceOf(p.attends, h.events),
      ...(p.diet ? { diet: p.diet } : {}),
    }));
    if (h.response.plusOne) {
      people.push({
        guest_id: null,
        person_name: h.response.plusOne.name,
        attendance: attendanceOf(h.response.plusOne.attends, h.events),
      });
    }
    if (h.response.extraChild) {
      people.push({
        guest_id: null,
        person_name: h.response.extraChild.name,
        is_child: true,
        age: h.response.extraChild.age,
        attendance: attendanceOf(h.response.extraChild.attends, h.events),
      });
    }
    // otázky vázané na událost se vyplňují jen u těch, kdo na ni přijdou
    const answers = { ...h.response.answers };
    const dinnerAttending = people.some((p) =>
      p.attendance.some((a) => a.event_id === ev.dinner && a.attending),
    );
    const partyAttending = people.some((p) =>
      p.attendance.some((a) => a.event_id === ev.party && a.attending),
    );
    if (!dinnerAttending) delete answers.menu;
    if (!partyAttending) delete answers.afterparty;
    await rpc(
      client,
      "rsvp_submit",
      { p_ticket: ticket, p_payload: { answers, people } },
      { as: visitor },
    );
    answered += 1;
  }
  log(`Hosté: ${content.DEMO_HOUSEHOLDS.length} domácností, ${answered} s odpovědí.`);
  return { households: content.DEMO_HOUSEHOLDS.length, answered, eventIds: ev, startsOn };
}

async function seedGifts(deps, weddingId, as) {
  const { client, libs, log } = deps;
  const { content } = libs;
  const existing = new Map(
    ((await rpc(client, "admin_gifts_list", {}, { as })) ?? []).map((g) => [g.title?.cs, g]),
  );
  for (const g of content.DEMO_GIFTS) {
    const found = existing.get(g.title.cs);
    await rpc(
      client,
      "admin_gift_save",
      {
        p_id: found?.id ?? null,
        p_payload: { title: g.title, description: g.description, url: g.url, price: g.price },
      },
      { as },
    );
  }
  // rezervace jako host po PINu (role guest_pin; subjekt je jen vymyšlený identifikátor relace)
  const guest = { sub: "5e2e0000-0000-4000-8000-0000000000a1", weddingId, role: "guest_pin" };
  const items = (await rpc(client, "admin_gifts_list", {}, { as })) ?? [];
  for (const g of content.DEMO_GIFTS) {
    if (g.reservedBy === null) continue;
    const row = items.find((i) => i.title?.cs === g.title.cs);
    if (row && !row.reserved_at) {
      await rpc(
        client,
        "gift_reserve",
        { p_id: row.id, p_name: g.reservedBy || null },
        { as: guest },
      );
    }
  }
  log(`Dary: ${content.DEMO_GIFTS.length} věcných darů (část rezervovaná).`);
}

async function seedVendors(deps, as) {
  const { client, libs } = deps;
  const existing = new Map(
    ((await rpc(client, "admin_vendors_list", {}, { as })) ?? []).map((v) => [v.name, v]),
  );
  for (const v of libs.content.DEMO_VENDORS) {
    await rpc(
      client,
      "admin_vendor_save",
      {
        p_id: existing.get(v.name)?.id ?? null,
        p_payload: {
          category: v.category,
          name: v.name,
          contact: v.contact,
          url: v.url,
          price: v.price,
          status: v.status,
          note: v.note,
        },
      },
      { as },
    );
  }
}

async function seedNotes(deps, as) {
  const { client, libs } = deps;
  const notes = await rpc(client, "admin_notes_get", {}, { as });
  await rpc(
    client,
    "admin_notes_save",
    { p_body: libs.content.DEMO_NOTES, p_rev: notes.rev },
    { as },
  );
}

async function seedSeating(deps, as, doc, stats) {
  const { client, libs, log } = deps;
  const { content } = libs;
  const data = await rpc(client, "admin_seating_get", {}, { as });
  const dinner = stats.eventIds.dinner;
  const base = content.buildSeatingBase(dinner);
  // osoby, které přijdou na hostinu, po domácnostech v pořadí ukázkových domácností
  const order = new Map(content.DEMO_HOUSEHOLDS.map((h, i) => [h.label, i]));
  const byHousehold = new Map();
  for (const p of data.people) {
    if (!p.attending.includes(dinner)) continue;
    const label = p.household ?? "~";
    if (!byHousehold.has(label)) byHousehold.set(label, []);
    byHousehold.get(label).push(p.key);
  }
  const groups = [...byHousehold.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
    .map(([, keys]) => keys);
  const plan = content.seatHouseholds(base, groups);
  await rpc(client, "admin_seating_save", { p_plan: plan, p_rev: data.rev }, { as });
  log(
    `Zasedací pořádek: ${plan.tables.length} stolů, usazeno ${Object.keys(plan.assignments).length} osob.`,
  );
}

// --- vstupní bod --------------------------------------------------------------------------------

async function makeStorage(env, libs, log, opts) {
  if (opts.noPhotos) return null;
  const result = libs.r2.r2ConfigFromEnv(env);
  if (result.status === "ok") return libs.r2.createR2Storage(result.config);
  if (result.anySet) {
    log(
      `Pozor: proměnné R2 jsou nastavené jen částečně (chybí ${result.missing.join(", ")}); fotografie se vynechají.`,
    );
  }
  return null;
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
  const config = clientConfig(url);
  // v logu GitHub Actions (může být veřejný) se host databáze nevypisuje
  const hideHost = process.env.GITHUB_ACTIONS === "true";
  for (const line of planLines(opts, config, { hideHost })) console.log(line);
  assertSafeTarget(config, opts);

  const libs = await loadLibs();
  const log = (message) => console.log(message);
  const storage = await makeStorage(process.env, libs, log, opts);
  const client = new pg.Client(config);
  await client.connect();
  try {
    const result = await runDemo({
      client,
      opts,
      env: process.env,
      log,
      storage,
      libs,
      now: new Date(),
    });
    if (result.deleted !== undefined) return;
    const root = (process.env.ROOT_DOMAIN ?? "se-vezmou.cz").trim();
    console.log("");
    console.log(`Demo web: https://${opts.slug}.${root}  (datum svatby ${result.startsOn})`);
    console.log("Web je zamčený: bez PINu hostů se zobrazí jen zamykací stránka.");
    if (result.pins.generated.length > 0) {
      console.log("");
      console.log(
        "VYGENEROVANÉ PINy (zobrazí se jen teď, nikam se neukládají, uložte je do správce hesel):",
      );
      if (result.pins.generated.includes("guest"))
        console.log(`  PIN hostů (odemkne web): ${result.pins.guest}`);
      if (result.pins.generated.includes("site"))
        console.log(`  PIN správy (přihlášení do správy): ${result.pins.site}`);
    } else {
      console.log("PINy byly zadány z prostředí a nevypisují se.");
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
