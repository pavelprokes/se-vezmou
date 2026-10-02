import { createHash } from "node:crypto";
import { HOSTS, pageUrl } from "./hosts";
import { exhaustRateLimit, uniqueTag, withDb } from "./support/db";
import { expectNoMail, readMails, waitForMail } from "./support/mail";
import { expect, submitAndWait, test } from "./support/fixtures";
import {
  admin,
  auditRows,
  freshTotp,
  loginAsOperator,
  operatorSessions,
  passFirstFactor,
  requestOperatorCode,
  seedOperator,
  totpFor,
} from "./support/ops";
import { totpAt } from "../src/ops/totp";

/**
 * Přihlášení operátora (M9, docs/adr/0012): e-mail a jednorázový kód, povinný druhý faktor TOTP, záložní
 * kódy, zápis faktoru při prvním přihlášení, relace (nečinnost, absolutní doba, host-only cookie), pauzy
 * po chybách a omezení počtu požadavků. Běží proti skutečnému PostgreSQL; e-maily se čtou z outboxu.
 * Po každé akci se čeká na viditelný výsledek, než test zadá další vstup.
 */

const SESSION_COOKIE = "sv_operator"; // lokálně bez prefixu __Host- a bez Secure (src/auth/cookie.ts)

test.describe("první přihlášení: zápis druhého faktoru", () => {
  test("klíč, QR kód, potvrzení kódem, jednorázově zobrazené záložní kódy", async ({ page }) => {
    const operator = await seedOperator({ enrolled: false });
    await passFirstFactor(page, operator);

    await expect(page).toHaveTitle(/Zapište druhý faktor/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Zapište druhý faktor" }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /QR kód pro aplikaci pro ověřování/ }),
    ).toBeVisible();

    // klíč je i textově (QR není jediná cesta, WCAG 1.1.1) a jde z něj opsat
    const shown = await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4}){7}$/).innerText();
    const secret = shown.replace(/ /g, "");
    expect(secret).toHaveLength(32);

    // před potvrzením se nedá do administrace
    await page.goto(admin("/zakazky"));
    await expect(page).toHaveURL(admin("/prihlaseni/faktor"));

    // chybný kód nic nezapíše
    await page.getByLabel("Šestimístný kód z aplikace").fill("12");
    await page.getByRole("button", { name: "Potvrdit a vytvořit záložní kódy" }).click();
    await expect(page.getByLabel("Šestimístný kód z aplikace")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByText(/Kód má šest číslic/)).toBeVisible();
    await page.getByLabel("Šestimístný kód z aplikace").fill("000000");
    await submitAndWait(page, "Potvrdit a vytvořit záložní kódy");
    await expect(page.getByText(/Kód nesouhlasí/)).toBeVisible();
    const before = await withDb((db) =>
      db.query("select totp_confirmed_at from se_vezmou.operators where id = $1", [operator.id]),
    );
    expect(before.rows[0].totp_confirmed_at).toBeNull();

    // správný kód z aplikace (vložený i s mezerou, jak ho opíše člověk)
    const code = totpAt(secret, Date.now());
    await page
      .getByLabel("Šestimístný kód z aplikace")
      .fill(`${code.slice(0, 3)} ${code.slice(3)}`);
    await page.getByRole("button", { name: "Potvrdit a vytvořit záložní kódy" }).click();
    await expect(page.getByRole("heading", { name: "Uložte si záložní kódy" })).toBeVisible();
    const codes = await page
      .getByRole("list", { name: "Záložní kódy" })
      .getByRole("listitem")
      .allInnerTexts();
    expect(codes).toHaveLength(10);
    for (const backup of codes) expect(backup).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);

    // v databázi je klíč jen zašifrovaný a záložní kódy jen jako hash
    const row = await withDb(async (db) => {
      const op = await db.query<{ totp_secret_enc: string; totp_confirmed_at: Date | null }>(
        "select totp_secret_enc, totp_confirmed_at from se_vezmou.operators where id = $1",
        [operator.id],
      );
      const hashes = await db.query<{ hex: string }>(
        "select encode(code_hash, 'hex') as hex from se_vezmou.operator_backup_codes where operator_id = $1",
        [operator.id],
      );
      return { op: op.rows[0], hashes: hashes.rows.map((r) => r.hex) };
    });
    expect(row.op.totp_confirmed_at).not.toBeNull();
    expect(row.op.totp_secret_enc).not.toContain(secret);
    expect(row.hashes).toHaveLength(10);
    for (const backup of codes) {
      const plain = backup.replace("-", "");
      expect(row.hashes.join(" ")).not.toContain(plain.toLowerCase());
      expect(row.hashes).not.toContain(createHash("sha256").update(plain).digest("hex"));
    }

    // relace je po zápisu AAL2 a audit to eviduje
    const [session] = await operatorSessions(operator.id);
    expect(session.aal2_verified_at).not.toBeNull();
    const audit = await auditRows("actor_id = $1", [operator.id]);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["operator.mfa_enrolled", "operator.login"]),
    );
    expect(JSON.stringify(audit)).not.toContain(secret);

    await page.getByRole("link", { name: "Mám uloženo, pokračovat do administrace" }).click();
    await page.waitForURL(admin("/"));
    await expect(page.getByRole("heading", { level: 1, name: "Přehled" })).toBeVisible();

    // při dalším otevření stránky zápisu se klíč znovu neukáže
    await page.goto(admin("/prihlaseni/faktor"));
    await expect(page).toHaveURL(admin("/"));
  });
});

test.describe("přihlášení kódem z e-mailu a TOTP", () => {
  test("relace: host-only cookie, v databázi jen hash tokenu, nečinnost 30 minut a absolutně 8 hodin", async ({
    page,
    context,
  }) => {
    const operator = await seedOperator({ enrolled: true });
    await loginAsOperator(page, operator);

    const cookies = await context.cookies(admin("/"));
    const cookie = cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: false });
    expect(cookie!.domain).toBe("admin.localhost");
    expect(cookie!.domain.startsWith(".")).toBe(false);
    const hours = (cookie!.expires - Date.now() / 1000) / 3600;
    expect(hours).toBeGreaterThan(7.9);
    expect(hours).toBeLessThan(8.1);
    expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE);
    expect(cookies.find((c) => c.name === "sv_operator_login")).toBeUndefined();

    // nikde jinde cookie není (ani na app., ani na webu páru)
    for (const host of [HOSTS.app, HOSTS.tenant, HOSTS.marketing]) {
      const names = (await context.cookies(pageUrl(host, "/"))).map((c) => c.name);
      expect(names, host).not.toContain(SESSION_COOKIE);
    }

    const [row] = await operatorSessions(operator.id);
    expect(row.token_hash).toBe(createHash("sha256").update(cookie!.value).digest("hex"));
    expect(row.token_hash).not.toContain(cookie!.value);
    expect(row.aal2_verified_at).not.toBeNull();
    expect(row.idle_seconds).toBe(1800);
    expect((+row.absolute_expires_at - +row.created_at) / 3_600_000).toBeCloseTo(8, 1);

    // přihlášení se oznamuje e-mailem operátorovi a je v auditu
    const notice = await waitForMail(operator.email, 2);
    expect(notice.subject).toBe("Přihlášení do provozní administrace");
    const audit = await auditRows("actor_id = $1 and action = 'operator.login'", [operator.id]);
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toEqual({ method: "totp" });
  });

  test("pole pro kódy: obyčejná pole bez blokace vložení, číselná klávesnice, kód z e-mailu i s mezerou", async ({
    page,
  }) => {
    const operator = await seedOperator({ enrolled: true });
    const code = await requestOperatorCode(page, operator.email);
    const field = page.getByLabel("Šestimístný kód");
    await expect(field).toHaveAttribute("autocomplete", "one-time-code");
    await expect(field).toHaveAttribute("inputmode", "numeric");
    await expect(field).not.toHaveAttribute("onpaste", /.*/);
    await expect(field).not.toHaveAttribute("readonly", /.*/);
    await field.fill(`${code.slice(0, 3)} ${code.slice(3)}`);
    await page.getByRole("button", { name: "Pokračovat" }).click();
    await page.waitForURL(admin("/prihlaseni/overeni"));

    const second = page.getByLabel("Kód z aplikace nebo záložní kód");
    await expect(second).toHaveAttribute("autocomplete", "one-time-code");
    await expect(second).not.toHaveAttribute("onpaste", /.*/);
    const totp = await freshTotp(operator);
    await second.fill(`${totp.slice(0, 3)} ${totp.slice(3)}`);
    await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
    await page.waitForURL(admin("/"));
  });

  test("po prvním faktoru je relace jen AAL1: administrace se neotevře a vede na druhý faktor", async ({
    page,
  }) => {
    const operator = await seedOperator({ enrolled: true });
    await passFirstFactor(page, operator);
    for (const path of ["/", "/zakazky", "/audit", "/operatori", "/retence", "/ucet"]) {
      await page.goto(admin(path));
      await expect(page, path).toHaveURL(admin("/prihlaseni/overeni"));
    }
    const [row] = await operatorSessions(operator.id);
    expect(row.aal2_verified_at).toBeNull();
  });

  test("bez relace vedou všechny stránky na přihlášení", async ({ page }) => {
    for (const path of [
      "/",
      "/zakazky",
      "/zakazky/00000000-0000-4000-8000-000000000000",
      "/audit",
      "/operatori",
      "/retence",
      "/ucet",
    ]) {
      await page.goto(admin(path));
      await expect(page, path).toHaveURL(admin("/prihlaseni"));
    }
  });

  test("kód TOTP jde použít jen jednou; další časový krok projde", async ({ page }) => {
    const operator = await seedOperator({ enrolled: true });
    await loginAsOperator(page, operator);
    const used = totpFor(operator);
    await page.getByRole("button", { name: "Odhlásit se" }).click();
    await page.waitForURL(admin("/prihlaseni"));

    await passFirstFactor(page, operator);
    await page.getByLabel("Kód z aplikace nebo záložní kód").fill(used);
    await submitAndWait(page, /^Přihlásit se$/);
    await expect(page.getByText(/Kód nesouhlasí nebo už byl použit/)).toBeVisible();
    await expect(page).toHaveURL(admin("/prihlaseni/overeni"));

    await page.getByLabel("Kód z aplikace nebo záložní kód").fill(totpFor(operator, 1));
    await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
    await page.waitForURL(admin("/"));
  });

  test("záložní kód: projde jednou, oznámí se e-mailem a zapíše do auditu", async ({ page }) => {
    const operator = await seedOperator({ enrolled: true });
    const [backup, other] = operator.backupCodes;
    await passFirstFactor(page, operator);
    await page.getByLabel("Kód z aplikace nebo záložní kód").fill(backup.toLowerCase());
    await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
    await page.waitForURL(admin("/"));

    const left = await withDb((db) =>
      db.query<{ n: number }>(
        "select count(*)::int as n from se_vezmou.operator_backup_codes where operator_id = $1 and used_at is null",
        [operator.id],
      ),
    );
    expect(left.rows[0].n).toBe(9);
    const audit = await auditRows("actor_id = $1 and action = 'operator.backup_code_used'", [
      operator.id,
    ]);
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toEqual({ remaining: 9 });
    const deadline = Date.now() + 15_000;
    while (!readMails(operator.email).some((m) => m.subject === "Použit záložní kód")) {
      if (Date.now() > deadline) throw new Error("Oznámení o záložním kódu nedorazilo");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // stejný kód podruhé neprojde, jiný ano
    await page.getByRole("button", { name: "Odhlásit se" }).click();
    await page.waitForURL(admin("/prihlaseni"));
    await passFirstFactor(page, operator);
    await page.getByLabel("Kód z aplikace nebo záložní kód").fill(backup);
    await submitAndWait(page, /^Přihlásit se$/);
    await expect(page.getByText(/Kód nesouhlasí nebo už byl použit/)).toBeVisible();
    await page.getByLabel("Kód z aplikace nebo záložní kód").fill(other);
    await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
    await page.waitForURL(admin("/"));
  });

  test("chybný tvar kódu se hlásí slovy a nepočítá se jako chyba", async ({ page }) => {
    const operator = await seedOperator({ enrolled: true });
    await passFirstFactor(page, operator);
    await page.getByLabel("Kód z aplikace nebo záložní kód").fill("abc");
    await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
    await expect(page.getByLabel("Kód z aplikace nebo záložní kód")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByText(/Zadejte šest číslic z\saplikace/)).toBeVisible();
    // tvar se kontroluje dřív než kód: ani po stovce špatně napsaných hodnot nevznikne pauza
    for (let attempt = 0; attempt < 6; attempt++) {
      await page.getByLabel("Kód z aplikace nebo záložní kód").fill(`ab${attempt}`);
      await submitAndWait(page, /^Přihlásit se$/);
    }
    await page.getByLabel("Kód z aplikace nebo záložní kód").fill(await freshTotp(operator));
    await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
    await page.waitForURL(admin("/"));
  });

  test("po pěti chybných kódech pauza; správný kód v pauze neprojde", async ({ page }) => {
    const operator = await seedOperator({ enrolled: true });
    await passFirstFactor(page, operator);
    const field = page.getByLabel("Kód z aplikace nebo záložní kód");
    for (let attempt = 1; attempt <= 5; attempt++) {
      await field.fill(attempt % 2 ? "000000" : "999999");
      await submitAndWait(page, /^Přihlásit se$/);
    }
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Zadávání kódů je dočasně pozastaveno",
    );
    await expect(page.locator("main").getByRole("alert")).toContainText(/15\sminut/);

    await field.fill(totpFor(operator));
    await submitAndWait(page, /^Přihlásit se$/);
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Zadávání kódů je dočasně pozastaveno",
    );
    await expect(page).toHaveURL(admin("/prihlaseni/overeni"));
    const [row] = await operatorSessions(operator.id);
    expect(row.aal2_verified_at).toBeNull();
  });

  test("po pěti chybných kódech z e-mailu se výzva zneplatní", async ({ page }) => {
    const operator = await seedOperator({ enrolled: true });
    const code = await requestOperatorCode(page, operator.email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.getByLabel("Šestimístný kód").fill(wrong);
      await submitAndWait(page, "Pokračovat");
    }
    await expect(page.getByText(/Kód nesouhlasí nebo už neplatí/)).toBeVisible();
    await page.getByLabel("Šestimístný kód").fill(code);
    await submitAndWait(page, "Pokračovat");
    await expect(page.getByText(/Kód nesouhlasí nebo už neplatí/)).toBeVisible();
    await expect(page).toHaveURL(admin("/prihlaseni/kod"));
  });

  test("kód z e-mailu je jednorázový", async ({ page, context }) => {
    const operator = await seedOperator({ enrolled: true });
    const code = await requestOperatorCode(page, operator.email);
    const pending = (await context.cookies(admin("/"))).find(
      (c) => c.name === "sv_operator_login",
    )!;
    expect(pending).toMatchObject({ httpOnly: true, sameSite: "Lax" });
    await page.getByLabel("Šestimístný kód").fill(code);
    await page.getByRole("button", { name: "Pokračovat" }).click();
    await page.waitForURL(admin("/prihlaseni/overeni"));
    await page.getByRole("button", { name: "Přihlásit se jako někdo jiný" }).click();
    await page.waitForURL(admin("/prihlaseni"));

    await context.addCookies([{ ...pending, expires: undefined }]);
    await page.goto(admin("/prihlaseni/kod"));
    await page.getByLabel("Šestimístný kód").fill(code);
    await submitAndWait(page, "Pokračovat");
    await expect(page.getByText(/Kód nesouhlasí nebo už neplatí/)).toBeVisible();
  });
});

test.describe("odpověď neprozradí, kdo je operátor", () => {
  test("neznámý e-mail: stejná stránka s kódem, žádný e-mail, kód nikdy neprojde", async ({
    page,
  }) => {
    const email = `nikdo-${uniqueTag()}@example.test`;
    await page.goto(admin("/prihlaseni"));
    await page.getByLabel("E-mail").fill(email);
    await page.getByRole("button", { name: "Poslat kód" }).click();
    await page.waitForURL(admin("/prihlaseni/kod"));
    await expect(page.getByText(/Pokud je tento e-mail veden jako operátorský/)).toBeVisible();
    await expectNoMail(email);
    await page.getByLabel("Šestimístný kód").fill("123456");
    await submitAndWait(page, "Pokračovat");
    await expect(page.getByText(/Kód nesouhlasí nebo už neplatí/)).toBeVisible();
  });

  test("zakázaný operátor kód nedostane", async ({ page }) => {
    const operator = await seedOperator({ enrolled: true });
    await withDb((db) =>
      db.query("update se_vezmou.operators set disabled_at = now() where id = $1", [operator.id]),
    );
    await page.goto(admin("/prihlaseni"));
    await page.getByLabel("E-mail").fill(operator.email);
    await page.getByRole("button", { name: "Poslat kód" }).click();
    await page.waitForURL(admin("/prihlaseni/kod"));
    await expectNoMail(operator.email);
  });

  test("neplatný e-mail se hlásí slovy", async ({ page }) => {
    await page.goto(admin("/prihlaseni"));
    await page.getByLabel("E-mail").fill("klara");
    await page.getByRole("button", { name: "Poslat kód" }).click();
    await expect(page.getByLabel("E-mail")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(/Zadejte platný e-mail/)).toBeVisible();
  });

  test("omezení počtu požadavků podle IP", async ({ page, ip }) => {
    await exhaustRateLimit("op-code-ip", ip, 20);
    await page.goto(admin("/prihlaseni"));
    await page.getByLabel("E-mail").fill(`kdokoli-${uniqueTag()}@example.test`);
    await page.getByRole("button", { name: "Poslat kód" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Zkuste to prosím znovu později.",
    );
    await expect(page).toHaveURL(admin("/prihlaseni"));
  });

  test("po vyčerpání limitu e-mailu je odpověď stejná, ale e-mail nedorazí", async ({ page }) => {
    const operator = await seedOperator({ enrolled: true });
    // limit je 5 za hodinu: předem spotřebovaný čítač
    await exhaustRateLimit("op-code-email", operator.email, 5);
    await page.goto(admin("/prihlaseni"));
    await page.getByLabel("E-mail").fill(operator.email);
    await page.getByRole("button", { name: "Poslat kód" }).click();
    await page.waitForURL(admin("/prihlaseni/kod"));
    await expectNoMail(operator.email);
  });
});

test.describe("relace", () => {
  test("po nečinnosti (30 minut) a po absolutní době (8 hodin) vyprší", async ({ page }) => {
    const operator = await seedOperator({ enrolled: true });
    await loginAsOperator(page, operator);

    await withDb((db) =>
      db.query(
        "update se_vezmou.operator_sessions set idle_expires_at = now() - interval '1 second' where operator_id = $1",
        [operator.id],
      ),
    );
    await page.goto(admin("/zakazky"));
    await expect(page).toHaveURL(admin("/prihlaseni"));

    await loginAsOperator(page, operator);
    await withDb((db) =>
      db.query(
        "update se_vezmou.operator_sessions set absolute_expires_at = now() - interval '1 second', idle_expires_at = now() + interval '1 day' where operator_id = $1 and revoked_at is null",
        [operator.id],
      ),
    );
    await page.goto(admin("/zakazky"));
    await expect(page).toHaveURL(admin("/prihlaseni"));
  });

  test("aktivní relace se posouvá, ale zápis je jen občas; nečinnost se počítá od poslední aktivity", async ({
    page,
  }) => {
    const operator = await seedOperator({ enrolled: true });
    await loginAsOperator(page, operator);
    const [fresh] = await operatorSessions(operator.id);

    await page.goto(admin("/zakazky"));
    const [again] = await operatorSessions(operator.id);
    expect(+again.last_seen_at).toBe(+fresh.last_seen_at);

    await withDb((db) =>
      db.query(
        "update se_vezmou.operator_sessions set last_seen_at = now() - interval '10 minutes', idle_expires_at = now() + interval '20 minutes' where operator_id = $1",
        [operator.id],
      ),
    );
    await page.goto(admin("/zakazky"));
    const [moved] = await operatorSessions(operator.id);
    expect((+moved.idle_expires_at - Date.now()) / 60_000).toBeGreaterThan(29);
    expect(+moved.idle_expires_at).toBeLessThanOrEqual(+moved.absolute_expires_at);
  });

  test("odhlášení odvolá relaci a starý token po něm nefunguje", async ({ page, context }) => {
    const operator = await seedOperator({ enrolled: true });
    await loginAsOperator(page, operator);
    const cookie = (await context.cookies(admin("/"))).find((c) => c.name === SESSION_COOKIE)!;

    await page.getByRole("button", { name: "Odhlásit se" }).click();
    await page.waitForURL(admin("/prihlaseni"));
    expect(
      (await context.cookies(admin("/"))).find((c) => c.name === SESSION_COOKIE),
    ).toBeUndefined();
    expect((await operatorSessions(operator.id))[0].revoked_at).not.toBeNull();

    await context.addCookies([{ ...cookie, expires: undefined }]);
    await page.goto(admin("/zakazky"));
    await expect(page).toHaveURL(admin("/prihlaseni"));
  });

  test("zakázaný operátor o relaci přijde hned", async ({ page }) => {
    const operator = await seedOperator({ enrolled: true });
    await loginAsOperator(page, operator);
    await withDb((db) =>
      db.query("update se_vezmou.operators set disabled_at = now() where id = $1", [operator.id]),
    );
    await page.goto(admin("/zakazky"));
    await expect(page).toHaveURL(admin("/prihlaseni"));
  });
});
