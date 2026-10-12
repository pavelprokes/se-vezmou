import AxeBuilder from "@axe-core/playwright";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { apiRequest, HOSTS } from "./hosts";
import { loginAs, tenantUrl, appUrl } from "./support/admin";
import { withDb } from "./support/db";
import { databaseUrl, E2E_SECRETS } from "./support/env";
import { rateKey } from "../src/auth/rate-limit";
import { expect, test } from "./support/fixtures";
import { TAGS } from "./site";

/**
 * Demo web „Test a Test“ (scripts/demo-seed.mjs, docs/demo-web.md): skript založí v e2e databázi plně
 * vyplněný zamčený web, který se odemkne PINem hostů. Ověřuje se zamčení bez PINu (nic z obsahu v HTML,
 * limity pokusů), neveřejnost (noindex, robots, mapa webu, llms.txt, úvodní stránka), klíčové sekce v češtině
 * i angličtině, správa nad demo daty (hosté, odpovědi, zasedací pořádek, jmenovky, dary), idempotence,
 * reset a smazání s obnovou a přístupnost. Fotografie (R2) se ověřují jinde: aplikace v e2e má úložiště
 * v paměti jiného procesu, takže skript tu běží bez nich a galerie nese odkaz na externí galerii.
 */

const SLUG = "test-a-test";
const GUEST_PIN = "482915";
const SITE_PIN = "739204";
const WRONG = "135790";
const ADMIN_EMAIL = "majitel-dema@example.test";
const ROOT = resolve(__dirname, "..");

const run = promisify(execFile);

/** Spustí skript tak, jak ho spustí majitel (tsx), proti e2e databázi; vrací výstup konzole. */
async function seed(args: string[] = [], env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await run(
    process.execPath,
    ["--import", "tsx", "scripts/demo-seed.mjs", ...args],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        MIGRATE_DATABASE_URL: databaseUrl(),
        PIN_PEPPER: E2E_SECRETS.PIN_PEPPER,
        DEMO_ADMIN_EMAIL: ADMIN_EMAIL,
        DEMO_GUEST_PIN: GUEST_PIN,
        DEMO_SITE_PIN: SITE_PIN,
        ...env,
      },
      timeout: 120_000,
    },
  );
  return stdout;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  return withDb(async (db) => Number((await db.query(sql, params)).rows[0].n));
}

const weddingOf = (slug: string) =>
  withDb(async (db) => {
    const r = await db.query<{ id: string; status: string }>(
      "select id, status from se_vezmou.weddings where slug = $1",
      [slug],
    );
    return r.rows[0];
  });

/** Kdo se jako host zamyká: čítače pauz podle svatby a IP (stejné klíče jako aplikace). */
function lockoutKeys(slug: string, ip: string): string[] {
  const secret = E2E_SECRETS.RATE_LIMIT_SECRET;
  return [
    rateKey(secret, "pin-guest-wedding-ip", `${slug}\0${ip}`),
    rateKey(secret, "pin-guest-wedding", slug),
  ];
}

async function endLockout(slug: string, ip: string): Promise<void> {
  await withDb((db) =>
    db.query(
      "update se_vezmou.lockouts set locked_until = now() - interval '1 second' where bucket_key = any($1)",
      [lockoutKeys(slug, ip)],
    ),
  );
}

async function clearLockouts(slug: string, ip: string): Promise<void> {
  await withDb((db) =>
    db.query("delete from se_vezmou.lockouts where bucket_key = any($1)", [lockoutKeys(slug, ip)]),
  );
}

async function enterPin(page: Page, pin: string): Promise<void> {
  const field = page.getByLabel(/PIN (z\soznámení|from\syour\sinvitation)/).first();
  await field.fill(pin);
  const response = page.waitForResponse((r) => r.request().method() === "POST");
  await page
    .getByRole("button", { name: /Odemknout|Unlock/ })
    .first()
    .click();
  await response;
  // React po dokončení akce formulář vyprázdní (nebo ho odemčením nahradí obsahem): další psaní až potom
  await expect(async () => {
    const values = await page
      .getByLabel(/PIN (z\soznámení|from\syour\sinvitation)/)
      .evaluateAll((fields) => fields.map((f) => (f as HTMLInputElement).value));
    expect(values.every((value) => value === "")).toBe(true);
  }).toPass();
}

async function violations(page: Page) {
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target),
  }));
}

const HIDDEN = [
  "Svatební obřad",
  "Zámecká 1",
  "Penzion U Řeky",
  "19-2000145399",
  "Altánová",
  "Wedding ceremony",
];

test.describe.configure({ mode: "serial" });

test.describe("demo web: založení skriptem", () => {
  test.beforeAll(async () => {
    const out = await seed();
    expect(out).toContain("Web je zamčený");
    // PINy z prostředí se nevypisují
    expect(out).not.toContain(GUEST_PIN);
    expect(out).not.toContain(SITE_PIN);
    expect(out).toContain("Fotografie: VYNECHÁNY");
  });

  test("databáze: obsah, přístup a stav dema", async () => {
    const w = await weddingOf(SLUG);
    expect(w.status).toBe("published");
    const row = await withDb(async (db) => {
      const r = await db.query(
        `select w.site_locked, w.guest_pin_enabled, w.template, w.palette, w.starts_on - current_date as days,
                wa.guest_pin_hash is not null as guest_hash, wa.admin_pin_hash is not null as admin_hash,
                wa.backup_email_confirmed_at is null as backup_unconfirmed, wa.guest_pin_hash, wa.admin_pin_hash,
                w.guest_purge_at > now() as guest_ok, w.published_version_id is not null as published
           from se_vezmou.weddings w join se_vezmou.wedding_auth wa on wa.wedding_id = w.id where w.id = $1`,
        [w.id],
      );
      return r.rows[0];
    });
    expect(row).toMatchObject({
      site_locked: true,
      guest_pin_enabled: true,
      template: "louka",
      palette: "levandule",
      guest_hash: true,
      admin_hash: true,
      backup_unconfirmed: true,
      published: true,
      guest_ok: true,
    });
    // svatba je hodně daleko, takže retenční lhůty nezasáhnou
    expect(Number(row.days)).toBeGreaterThan(300);
    // PINy jsou jen jako hash argon2id, nikde v čitelné podobě
    expect(row.guest_pin_hash).toMatch(/^\$argon2id\$/);
    expect(row.guest_pin_hash).not.toContain(GUEST_PIN);

    expect(
      await count("select count(*) n from se_vezmou.households where wedding_id = $1", [w.id]),
    ).toBe(12);
    expect(
      await count("select count(*) n from se_vezmou.guests where wedding_id = $1", [w.id]),
    ).toBe(22);
    expect(
      await count("select count(*) n from se_vezmou.rsvp_responses where wedding_id = $1", [w.id]),
    ).toBe(8);
    expect(
      await count("select count(*) n from se_vezmou.events where wedding_id = $1", [w.id]),
    ).toBe(5);
    expect(
      await count("select count(*) n from se_vezmou.gift_items where wedding_id = $1", [w.id]),
    ).toBe(6);
    expect(
      await count(
        "select count(*) n from se_vezmou.gift_items where wedding_id = $1 and reserved_at is not null",
        [w.id],
      ),
    ).toBe(2);
    expect(
      await count("select count(*) n from se_vezmou.vendors where wedding_id = $1", [w.id]),
    ).toBe(6);
    expect(
      await count(
        "select count(*) n from se_vezmou.wedding_admins where wedding_id = $1 and removed_at is null",
        [w.id],
      ),
    ).toBe(2);
    expect(
      await count("select count(*) n from se_vezmou.rsvp_questions where wedding_id = $1", [w.id]),
    ).toBe(2);
    // odpovědi zadal host (osobním odkazem), ne správce
    expect(
      await count(
        "select count(*) n from se_vezmou.rsvp_responses where wedding_id = $1 and entered_by = 'guest'",
        [w.id],
      ),
    ).toBe(8);
    // žádný e-mail se neodeslal ani nezařadil
    expect(
      await count("select count(*) n from se_vezmou.email_log where wedding_id = $1", [w.id]),
    ).toBe(0);
    // oznámení provozovateli vzniká jen v aplikaci; ve frontě notifikací nic není
    expect(
      await count("select count(*) n from se_vezmou.lifecycle_notices where wedding_id = $1", [
        w.id,
      ]),
    ).toBe(0);
  });

  test("bez PINu je web zamčený: jen zamykací stránka, nic z obsahu není v HTML (cs i en)", async ({
    page,
    request,
  }) => {
    for (const path of ["/", "/en"]) {
      await page.goto(tenantUrl(SLUG, path));
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Klára");
      await expect(
        page.getByRole("heading", {
          level: 2,
          name: /Web je jen pro pozvané hosty|This site is for invited guests only/,
        }),
      ).toBeVisible();
      const html = await page.content();
      for (const text of HIDDEN) expect(html).not.toContain(text);
      const { url, options } = apiRequest(`${SLUG}.localhost`, path);
      const raw = await (await request.get(url, options)).text();
      for (const text of HIDDEN) expect(raw).not.toContain(text);
    }
  });

  test("web je neveřejný: noindex, robots.txt, mapa webu, llms.txt a úvodní stránka o něm nevědí", async ({
    request,
  }) => {
    const site = apiRequest(`${SLUG}.localhost`, "/");
    const home = await request.get(site.url, site.options);
    expect(home.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(await home.text()).toContain('content="noindex, nofollow"');
    const en = apiRequest(`${SLUG}.localhost`, "/en");
    expect((await request.get(en.url, en.options)).headers()["x-robots-tag"]).toBe(
      "noindex, nofollow",
    );
    const robots = apiRequest(`${SLUG}.localhost`, "/robots.txt");
    const robotsTxt = await (await request.get(robots.url, robots.options)).text();
    expect(robotsTxt).toMatch(/Disallow: \//);

    for (const path of ["/", "/sitemap.xml", "/llms.txt", "/robots.txt", "/en", "/blog"]) {
      const { url, options } = apiRequest(HOSTS.marketing, path);
      const response = await request.get(url, options);
      const body = await response.text();
      expect(body, path).not.toContain(SLUG);
      expect(body, path).not.toContain("Test a Test");
    }
  });

  test("limity pokusů na PIN: pět chyb spustí pauzu, v pauze nepomůže ani správný PIN", async ({
    page,
    ip,
  }) => {
    await clearLockouts(SLUG, ip);
    await page.goto(tenantUrl(SLUG));
    for (let i = 0; i < 5; i++) {
      await enterPin(page, WRONG);
      await expect(page.getByRole("alert").getByText(/PIN nesouhlasí|pozastaveno/)).toBeVisible();
    }
    await enterPin(page, GUEST_PIN);
    await expect(page.getByText(/Zadávání PINu je dočasně pozastaveno/)).toBeVisible();
    await expect(page.getByText("Svatební obřad")).toHaveCount(0);
    // po skončení pauzy správný PIN projde
    await endLockout(SLUG, ip);
    await enterPin(page, GUEST_PIN);
    await expect(page.getByText("Svatební obřad").first()).toBeVisible();
    await clearLockouts(SLUG, ip);
  });

  test("po PINu hostů jsou všechny sekce česky, včetně dat za PINem", async ({ page }) => {
    await page.goto(tenantUrl(SLUG));
    await enterPin(page, GUEST_PIN);
    await expect(page.locator("main#obsah")).toBeFocused();

    // úvod a rychlá změna
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Klára");
    await expect(page.getByText("Toto je ukázkový web.")).toBeVisible();
    // příběh, program, místa s mapou, ubytování a doprava, dress code, FAQ
    await expect(page.locator("#pribeh")).toContainText("horské chatě");
    await expect(page.locator("#program")).toContainText("Svatební hostina");
    await expect(page.locator("#program")).toContainText("První tanec a zábava");
    await expect(page.locator("#misto")).toContainText("Zámecká kaple a lipový dvůr");
    await expect(page.locator("#misto")).toContainText("Zámecká 1, 252 01 Dobřichovice");
    // soukromé místo se po PINu odemklo
    await expect(page.locator("#misto")).toContainText("Altánová 7");
    await expect(page.locator("#ubytovani")).toContainText("Penzion U Řeky");
    await expect(page.locator("#ubytovani")).toContainText("večerní autobus");
    await expect(page.locator("#dresscode")).toContainText("pastelových");
    await expect(page.locator("#faq")).toContainText("Kde zaparkuji?");
    // dary: účet za PINem, seznam věcných darů s rezervacemi
    await expect(page.locator("#dary")).toContainText("19-2000145399/0800");
    const registry = page.locator(".site-registry");
    await expect(registry.getByTestId("registry-item")).toHaveCount(6);
    // galerie: bez R2 odkaz na externí galerii
    await expect(page.locator("#galerie").getByRole("link").first()).toBeVisible();
    // kontakty a RSVP
    await expect(page.locator("#kontakt")).toContainText("Eva Svobodová");
    await expect(page.locator("#potvrdit-ucast")).toBeVisible();
  });

  test("po PINu hostů jsou všechny sekce anglicky", async ({ page }) => {
    await page.goto(tenantUrl(SLUG, "/en"));
    await enterPin(page, GUEST_PIN);
    await expect(page.getByText("This is a demo site.")).toBeVisible();
    await expect(page.locator("#pribeh")).toContainText("mountain cabin");
    await expect(page.locator("#program")).toContainText("Wedding dinner");
    await expect(page.locator("#misto")).toContainText("Castle chapel and linden courtyard");
    await expect(page.locator("#ubytovani")).toContainText("River Guesthouse");
    await expect(page.locator("#dresscode")).toContainText("pastel");
    await expect(page.locator("#faq")).toContainText("Where can I park?");
    await expect(page.locator("#dary")).toContainText("19-2000145399/0800");
    await expect(page.locator("#kontakt")).toContainText("Maid of honour");
    await expect(page.locator("#potvrdit-ucast")).toBeVisible();
  });

  test("osobní odkaz domácnosti zamčený web otevře a ukáže uloženou odpověď", async ({ page }) => {
    const w = await weddingOf(SLUG);
    const code = await withDb(async (db) => {
      // jen domácnost dema: jiné testy ve stejné databázi zakládají domácnosti se stejným názvem
      const r = await db.query<{ invite_code: string }>(
        "select invite_code from se_vezmou.households where wedding_id = $1 and label = 'Novákovi'",
        [w.id],
      );
      return r.rows[0].invite_code;
    });
    await page.goto(tenantUrl(SLUG, `/p/${code}`));
    await expect(page.getByText("Svatební obřad").first()).toBeVisible();
    await expect(page.locator("#potvrdit-ucast")).toContainText("Jana Nováková");
  });

  test("správa nad demo daty: hosté, odpovědi, zasedací pořádek, jmenovky a dary", async ({
    page,
    context,
  }) => {
    const w = await weddingOf(SLUG);
    const adminId = await withDb(async (db) => {
      const r = await db.query<{ id: string }>(
        "select id from se_vezmou.wedding_admins where wedding_id = $1 and email = $2",
        [w.id, ADMIN_EMAIL],
      );
      return r.rows[0].id;
    });
    await loginAs(context, w.id, adminId);

    await page.goto(appUrl("/hoste"));
    await expect(page.getByRole("heading", { level: 1, name: /Hosté/ })).toBeVisible();
    await expect(page.getByText("Novákovi").first()).toBeVisible();
    await expect(page.getByText("Kolegové z práce").first()).toBeVisible();

    await page.goto(appUrl("/odpovedi"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goto(appUrl("/hoste/zasedaci-poradek"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("main")).toContainText("Stůl 1 (volno 0 z 8)");

    // karty s QR osobních odkazů (domácnosti) a cedulka s QR galerie (odkaz na externí galerii)
    await page.goto(appUrl("/hoste/karty"));
    await expect(page.getByRole("heading", { level: 2, name: "Novákovi" })).toBeVisible();
    await page.goto(appUrl("/web/cedulka"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("img", { name: /^Cedulka s QR kódem/ }).first()).toBeVisible();

    await page.goto(appUrl("/dary"));
    await expect(page.getByText("Pákový kávovar").first()).toBeVisible();

    await page.goto(appUrl("/poznamky"));
    await expect(page.getByText("Ukázkové foto studio").first()).toBeVisible();

    await page.goto(appUrl("/pristup"));
    await expect(page.getByText("demo-druhy-spravce@example.invalid").first()).toBeVisible();
    await expect(page.getByText("demo-zaloha@example.invalid").first()).toBeVisible();

    // jmenovky nad demo daty: PDF ke stažení
    await page.goto(appUrl("/hoste/jmenovky"));
    await page.getByLabel("Pro všechny pozvané").check();
    await page.getByRole("button", { name: "Zobrazit náhled" }).click();
    await expect(page.getByRole("img", { name: /^Jmenovka: / }).first()).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Stáhnout PDF k tisku" }).click(),
    ]);
    const pdf = readFileSync((await download.path())!);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  test("přístupnost: zamykací stránka i odemčený web, česky i anglicky", async ({ page }) => {
    await page.goto(tenantUrl(SLUG));
    expect(await violations(page)).toEqual([]);
    await enterPin(page, GUEST_PIN);
    await expect(page.getByText("Svatební obřad").first()).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.goto(tenantUrl(SLUG, "/en"));
    await expect(page.getByText("Wedding ceremony").first()).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test("opakovaný běh aktualizuje na místě: žádné duplicity, stejné adresy a PIN dál platí", async () => {
    const w = await weddingOf(SLUG);
    const before = await count(
      "select count(*) n from se_vezmou.site_versions where wedding_id = $1",
      [w.id],
    );
    const out = await seed();
    expect(out).not.toContain("Založena svatba");
    const again = await weddingOf(SLUG);
    expect(again.id).toBe(w.id);
    expect(
      await count("select count(*) n from se_vezmou.site_versions where wedding_id = $1", [w.id]),
    ).toBe(before + 1);
    expect(
      await count("select count(*) n from se_vezmou.households where wedding_id = $1", [w.id]),
    ).toBe(12);
    expect(
      await count("select count(*) n from se_vezmou.guests where wedding_id = $1", [w.id]),
    ).toBe(22);
    expect(
      await count("select count(*) n from se_vezmou.rsvp_responses where wedding_id = $1", [w.id]),
    ).toBe(8);
    expect(
      await count("select count(*) n from se_vezmou.gift_items where wedding_id = $1", [w.id]),
    ).toBe(6);
    expect(
      await count("select count(*) n from se_vezmou.vendors where wedding_id = $1", [w.id]),
    ).toBe(6);
    expect(
      await count("select count(*) n from se_vezmou.rsvp_questions where wedding_id = $1", [w.id]),
    ).toBe(2);
    expect(
      await count("select count(*) n from se_vezmou.events where wedding_id = $1", [w.id]),
    ).toBe(5);
    expect(
      await count(
        "select count(*) n from se_vezmou.wedding_admins where wedding_id = $1 and removed_at is null",
        [w.id],
      ),
    ).toBe(2);
  });

  test("--reset smaže přidané odpovědi hostů i cizí domácnosti a založí demo znovu", async () => {
    const w = await weddingOf(SLUG);
    await withDb(async (db) => {
      await db.query(
        "insert into se_vezmou.households (wedding_id, label) values ($1, 'Cizí domácnost')",
        [w.id],
      );
    });
    const out = await seed(["--reset"]);
    expect(out).toContain("Obsah dema smazán");
    expect(
      await count(
        "select count(*) n from se_vezmou.households where wedding_id = $1 and label = 'Cizí domácnost'",
        [w.id],
      ),
    ).toBe(0);
    expect(
      await count("select count(*) n from se_vezmou.households where wedding_id = $1", [w.id]),
    ).toBe(12);
    expect(
      await count("select count(*) n from se_vezmou.rsvp_responses where wedding_id = $1", [w.id]),
    ).toBe(8);
  });
});

test.describe("demo web: životní cyklus a ochrany", () => {
  const CYCLE = "ukazka-cyklus";

  test("vygenerované PINy se vypíšou jednou, s --require-pins se negenerují", async () => {
    await expect(
      seed(["--slug", CYCLE, "--require-pins"], { DEMO_GUEST_PIN: "", DEMO_SITE_PIN: "" }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("Chybí DEMO_GUEST_PIN") });
    expect(await weddingOf(CYCLE)).toBeUndefined();

    const out = await seed(["--slug", CYCLE], { DEMO_GUEST_PIN: "", DEMO_SITE_PIN: "" });
    const guest = /PIN hostů \(odemkne web\): (\d{6})/.exec(out)?.[1];
    const site = /PIN správy \(přihlášení do správy\): (\d{6})/.exec(out)?.[1];
    expect(guest).toBeTruthy();
    expect(site).toBeTruthy();
    expect(guest).not.toBe(site);
    // opakovaný běh bez PINů ponechá stávající a nic nevypíše
    const second = await seed(["--slug", CYCLE], { DEMO_GUEST_PIN: "", DEMO_SITE_PIN: "" });
    expect(second).not.toMatch(/VYGENEROVAN/);
  });

  test("--delete web smaže a opakované spuštění ho obnoví", async ({ request }) => {
    const out = await seed(["--delete", "--slug", CYCLE]);
    expect(out).toContain("Demo web je smazaný");
    const w = await weddingOf(CYCLE);
    expect(w.status).toBe("deleted");
    const { url, options } = apiRequest(`${CYCLE}.localhost`, "/");
    expect((await request.get(url, options)).status()).toBe(404);

    const restored = await seed(["--slug", CYCLE]);
    expect(restored).toContain("obnoveno na zveřejněné");
    expect((await weddingOf(CYCLE)).status).toBe("published");
    expect((await request.get(url, options)).status()).toBe(200);
    expect(
      await count("select count(*) n from se_vezmou.households where wedding_id = $1", [w.id]),
    ).toBe(12);
  });

  test("bez PIN_PEPPER skript odmítne nastavit PIN a nic nezmění", async () => {
    await expect(seed(["--slug", "ukazka-bez-pepru"], { PIN_PEPPER: "" })).rejects.toMatchObject({
      stderr: expect.stringContaining("PIN_PEPPER"),
    });
    expect(await weddingOf("ukazka-bez-pepru")).toBeUndefined();
  });

  test("vyhrazená a zabraná adresa se odmítne", async () => {
    await expect(seed(["--slug", "test"])).rejects.toMatchObject({
      stderr: expect.stringContaining("nejde přidělit"),
    });
    await expect(seed(["--slug", "admin"])).rejects.toMatchObject({
      stderr: expect.stringContaining("nejde přidělit"),
    });
  });
});

test.describe("demo web: fotografie", () => {
  // Aplikace v e2e má úložiště v paměti vlastního procesu, takže soubory tu skript zapisuje do paměti pomocného
  // procesu (stejný kód jako u R2, jen jiná implementace PhotoStorage) a měří se databáze a snímek webu.
  test("ukázkové fotografie projdou stejným zpracováním jako nahrání párem, jsou popsané a idempotentní", async () => {
    test.setTimeout(240_000);
    const { stdout } = await run(
      process.execPath,
      [
        "--import",
        "tsx",
        "e2e/support/demo-photos-runner.mjs",
        "ukazka-fotky",
        ADMIN_EMAIL,
        GUEST_PIN,
        SITE_PIN,
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          MIGRATE_DATABASE_URL: databaseUrl(),
          PIN_PEPPER: E2E_SECRETS.PIN_PEPPER,
        },
        timeout: 180_000,
      },
    );
    type Step = {
      step: string;
      wedding: boolean;
      files: number;
      media: {
        status: string;
        kind: string;
        decorative: boolean;
        alt: { cs: string; en: string };
      }[];
      snapshotMedia: { alt: { cs: string; en: string } | null }[];
      galleryIds: number | null;
      photos: { count: number; storage: string } | null;
    };
    const steps = JSON.parse(stdout.trim().split("\n").at(-1)!) as [
      Step,
      Step,
      Step,
      Step,
      { expected: number },
    ];
    const [create, again, reset, deleted, { expected }] = steps;

    // šest fotografií, každá ve třech šířkách a dvou formátech, hotové a popsané česky i anglicky
    expect(create.photos).toEqual({ count: expected, storage: "memory" });
    expect(create.media).toHaveLength(expected);
    for (const row of create.media) {
      expect(row).toMatchObject({ status: "ready", kind: "photo", decorative: false });
      expect(row.alt.cs).toBeTruthy();
      expect(row.alt.en).toBeTruthy();
    }
    expect(create.files).toBe(expected * 6);
    // zveřejněný snímek nese fotografie s popisky; galerie je ukazuje všechny
    expect(create.snapshotMedia).toHaveLength(expected);
    expect(create.snapshotMedia.every((m) => m.alt?.cs && m.alt?.en)).toBe(true);
    expect(create.galleryIds).toBe(expected);

    // opakovaný běh fotografie znovu nenahrává
    expect(again.media).toHaveLength(expected);
    expect(again.files).toBe(create.files);
    // --reset smaže soubory PŘED řádky a nahraje je znovu, nic nezůstane navíc
    expect(reset.media).toHaveLength(expected);
    expect(reset.files).toBe(create.files);
    // --delete odstraní fotografie z úložiště i z databáze
    expect(deleted.media).toEqual([]);
    expect(deleted.files).toBe(0);
  });
});
