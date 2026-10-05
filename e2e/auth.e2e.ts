import { createHash } from "node:crypto";
import { HOSTS, pageUrl } from "./hosts";
import {
  challengeOf,
  emailLogFor,
  endLockout,
  exhaustRateLimit,
  expireChallenges,
  lockoutsFor,
  seedWedding,
  sessionsOf,
  withDb,
} from "./support/db";
import { seedManagedSite } from "./support/admin";
import { codeOf, expectNoMail, linkOf, readMails, waitForMail } from "./support/mail";
import { app, expect, requestCode, submitAndWait, test } from "./support/fixtures";

/**
 * Přihlášení správce (M4): kód z e-mailu, odkaz, PIN, relace, pauzy a omezení počtu požadavků.
 * Běží proti skutečné databázi s migracemi; e-maily se zapisují do souborů (outbox) místo odeslání.
 * Odpovídá E2E-08 a E2E-09 z docs/test-plan.md.
 */

const SESSION_COOKIE = "sv_admin"; // lokálně bez prefixu __Host- a bez Secure (src/auth/cookie.ts)

async function submitCode(page: import("@playwright/test").Page, code: string) {
  await page.getByLabel("Šestimístný kód").fill(code);
  await submitAndWait(page, "Přihlásit se");
}

async function expectDashboard(page: import("@playwright/test").Page) {
  await expect(page).toHaveURL(app("/"));
  await expect(page.getByRole("heading", { level: 1, name: "Můj web" })).toBeVisible();
  await expect(page.getByTestId("current-wedding")).toContainText(/Klára a\s+Matěj/);
}

test.describe("přihlášení kódem z e-mailu", () => {
  test("jeden e-mail, víc svateb: po přihlášení výběr, v hlavičce jména a přepnutí", async ({
    page,
  }) => {
    const first = await seedManagedSite({ names: ["Klára", "Matěj"] });
    await seedManagedSite({ names: ["Eva", "Petr"], adminEmail: first.adminEmail });

    await requestCode(page, first.adminEmail);
    await submitCode(page, codeOf(await waitForMail(first.adminEmail)));
    await expect(page).toHaveURL(app("/svatby"));
    await expect(page.getByRole("heading", { level: 1, name: "Vaše svatby" })).toBeVisible();

    await page.getByRole("button", { name: /Spravovat: Eva a\s+Petr/ }).click();
    await expect(page).toHaveURL(app("/"));
    const header = page.getByTestId("current-wedding");
    await expect(header).toContainText(/Spravujete:\s+Eva a\s+Petr/);
    await header.getByRole("link", { name: "Přepnout svatbu" }).click();
    await expect(page).toHaveURL(app("/svatby"));
    await page.getByRole("link", { name: /Pokračovat: Eva a\s+Petr/ }).click();
    await expect(page).toHaveURL(app("/"));
  });

  test("jedna svatba: rovnou do správy, v hlavičce jména bez přepínání", async ({ page }) => {
    const only = await seedManagedSite({ names: ["Klára", "Matěj"] });
    await requestCode(page, only.adminEmail);
    await submitCode(page, codeOf(await waitForMail(only.adminEmail)));
    await expect(page).toHaveURL(app("/"));
    const header = page.getByTestId("current-wedding");
    await expect(header).toContainText(/Klára a\s+Matěj/);
    await expect(header.getByRole("link", { name: "Přepnout svatbu" })).toHaveCount(0);
    // stránka výběru s jedinou svatbou vrátí do přehledu
    await page.goto(app("/svatby"));
    await expect(page).toHaveURL(app("/"));
  });

  test("vložení ze schránky, relace v cookie a v databázi jen hash, odhlášení", async ({
    page,
    context,
  }) => {
    const wedding = await seedWedding();

    // chráněná stránka bez relace přesměruje na přihlášení
    await page.goto(app("/"));
    await expect(page).toHaveURL(app("/prihlaseni"));

    await requestCode(page, wedding.adminEmail);
    const mail = await waitForMail(wedding.adminEmail);
    expect(mail.subject).toMatch(/^\d{6} je váš přihlašovací kód do Se vezmou$/);
    const code = codeOf(mail);

    // kód vložený i s mezerou (jak ho uživatel opíše nebo vloží ze schránky)
    await submitCode(page, `${code.slice(0, 3)} ${code.slice(3)}`);
    await expectDashboard(page);

    // cookie: HttpOnly, SameSite=Lax, bez Domain (host-only), lokálně bez Secure a bez prefixu
    const cookies = await context.cookies(app("/"));
    const session = cookies.find((c) => c.name === SESSION_COOKIE);
    expect(session).toBeDefined();
    expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: false });
    expect(session!.domain.startsWith(".")).toBe(false);
    expect(session!.domain).toBe("app.localhost");
    expect(session!.expires).toBeGreaterThan(Date.now() / 1000 + 59 * 86400);
    expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE);

    // rozpracované přihlášení po úspěchu zaniká
    expect(cookies.find((c) => c.name === "sv_login")).toBeUndefined();

    // databáze: relace správce této svatby, uložen jen SHA-256 tokenu
    const rows = await sessionsOf(wedding.weddingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "admin", subject_id: wedding.adminId, revoked_at: null });
    expect(rows[0].token_hash).toBe(createHash("sha256").update(session!.value).digest("hex"));
    expect(rows[0].token_hash).not.toContain(session!.value);
    const lifetimeDays = (+rows[0].absolute_expires_at - +rows[0].last_seen_at) / 86_400_000;
    expect(Math.round(lifetimeDays)).toBe(60);
    const idleDays = (+rows[0].idle_expires_at - +rows[0].last_seen_at) / 86_400_000;
    expect(Math.round(idleDays)).toBe(14);

    // e-mail v záznamu je jen hash a doména
    const log = await emailLogFor(wedding.adminEmail);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      type: "login_code",
      locale: "cs",
      recipient_domain: "example.test",
    });
    expect(JSON.stringify(log[0])).not.toContain("spravce-");
    expect(log[0].status).toBe("sent");

    // odhlášení: relace se odvolá na serveru a cookie zanikne
    await page.getByRole("button", { name: "Odhlásit se" }).click();
    await expect(page).toHaveURL(app("/prihlaseni"));
    expect(
      (await context.cookies(app("/"))).find((c) => c.name === SESSION_COOKIE),
    ).toBeUndefined();
    expect((await sessionsOf(wedding.weddingId))[0].revoked_at).not.toBeNull();

    // starý token po odhlášení nefunguje, ani když ho prohlížeč vrátí
    await context.addCookies([{ ...session!, expires: undefined }]);
    await page.goto(app("/"));
    await expect(page).toHaveURL(app("/prihlaseni"));
  });

  test("kód je jednorázový: po použití se znovu nepřijme", async ({ page, context }) => {
    const wedding = await seedWedding();
    await requestCode(page, wedding.adminEmail);
    const code = codeOf(await waitForMail(wedding.adminEmail));
    const pending = (await context.cookies(app("/"))).find((c) => c.name === "sv_login")!;
    expect(pending).toMatchObject({ httpOnly: true, sameSite: "Lax" });

    await submitCode(page, code);
    await expectDashboard(page);
    await page.getByRole("button", { name: "Odhlásit se" }).click();
    await expect(page).toHaveURL(app("/prihlaseni"));

    // stejný kód znovu (rozpracované přihlášení vrátíme do prohlížeče)
    await context.addCookies([{ ...pending, expires: undefined }]);
    await page.goto(app("/prihlaseni/kod"));
    await submitCode(page, code);
    await expect(page.getByText("Kód nesouhlasí nebo už neplatí.")).toBeVisible();
    await expect(page).toHaveURL(app("/prihlaseni/kod"));
  });

  test("po pěti chybách se výzva zneplatní i pro správný kód", async ({ page }) => {
    const wedding = await seedWedding();
    await requestCode(page, wedding.adminEmail);
    const code = codeOf(await waitForMail(wedding.adminEmail));
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i++) {
      await submitCode(page, wrong);
      await expect(page.getByText("Kód nesouhlasí nebo už neplatí.")).toBeVisible();
    }
    await expect
      .poll(async () => (await challengeOf(wedding.adminEmail))[0].consumed_at)
      .not.toBeNull();

    await submitCode(page, code);
    await expect(page.getByText("Kód nesouhlasí nebo už neplatí.")).toBeVisible();
    await expect(page).toHaveURL(app("/prihlaseni/kod"));
  });

  test("kód po vypršení platnosti (10 minut) nefunguje", async ({ page }) => {
    const wedding = await seedWedding();
    await requestCode(page, wedding.adminEmail);
    const code = codeOf(await waitForMail(wedding.adminEmail));

    const [challenge] = await challengeOf(wedding.adminEmail);
    expect(Math.round((+challenge.expires_at - +challenge.created_at) / 60_000)).toBe(10);

    await expireChallenges(wedding.adminEmail);
    await submitCode(page, code);
    await expect(page.getByText("Kód nesouhlasí nebo už neplatí.")).toBeVisible();
  });

  test("nový kód zneplatní předchozí", async ({ page }) => {
    const wedding = await seedWedding();
    await requestCode(page, wedding.adminEmail);
    const first = codeOf(await waitForMail(wedding.adminEmail, 1));
    await requestCode(page, wedding.adminEmail);
    const second = codeOf(await waitForMail(wedding.adminEmail, 2));
    expect(second).not.toBe(first);

    await submitCode(page, first);
    await expect(page.getByText("Kód nesouhlasí nebo už neplatí.")).toBeVisible();
    await submitCode(page, second);
    await expectDashboard(page);
  });

  test("nesmyslný kód ukáže chybu u pole a zaměří ho", async ({ page }) => {
    const wedding = await seedWedding();
    await requestCode(page, wedding.adminEmail);
    await submitCode(page, "12ab");
    const field = page.getByLabel("Šestimístný kód");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Kód má šest číslic. Zkontrolujte ho, prosím.")).toBeVisible();
    await expect(field).toBeFocused();
  });

  test("kód nejde zadat v prohlížeči, který ho nevyžádal", async ({ page, browser }) => {
    const wedding = await seedWedding();
    await requestCode(page, wedding.adminEmail);

    const other = await browser.newContext({ locale: "cs-CZ" });
    const otherPage = await other.newPage();
    await otherPage.goto(app("/prihlaseni/kod"));
    await expect(otherPage).toHaveURL(app("/prihlaseni"));
    await other.close();
  });
});

test.describe("odkaz z e-mailu", () => {
  test("otevření odkazu nic nespotřebuje, přihlásí až potvrzení", async ({
    page,
    request,
    browser,
  }) => {
    const wedding = await seedWedding();
    await requestCode(page, wedding.adminEmail);
    const link = linkOf(await waitForMail(wedding.adminEmail));
    expect(link).toMatch(/^http:\/\/app\.localhost:\d+\/prihlaseni\/odkaz\?t=[\w-]+$/);
    // v adrese není čitelný e-mail ani kód
    expect(decodeURIComponent(link)).not.toContain("spravce-");

    // skener schránky odkaz jen otevře (GET), a to opakovaně
    for (let i = 0; i < 3; i++) {
      const response = await request.get(link.replace("app.localhost", "127.0.0.1"), {
        headers: { host: new URL(link).host },
      });
      expect(response.status()).toBe(200);
    }
    const [untouched] = await challengeOf(wedding.adminEmail);
    expect(untouched.consumed_at).toBeNull();
    expect(await sessionsOf(wedding.weddingId)).toHaveLength(0);

    // odkaz se otevře v jiném prohlížeči (např. v telefonu) a potvrzení přihlásí
    const phone = await browser.newContext({ locale: "cs-CZ" });
    const phonePage = await phone.newPage();
    await phonePage.goto(link);
    await expect(
      phonePage.getByRole("heading", { level: 1, name: "Potvrďte přihlášení" }),
    ).toBeVisible();
    await phonePage.getByRole("button", { name: "Přihlásit se" }).click();
    await expectDashboard(phonePage);
    expect((await challengeOf(wedding.adminEmail))[0].consumed_at).not.toBeNull();

    // odkaz už podruhé nefunguje
    await phonePage.getByRole("button", { name: "Odhlásit se" }).click();
    await expect(phonePage).toHaveURL(app("/prihlaseni"));
    await phonePage.goto(link);
    await phonePage.getByRole("button", { name: "Přihlásit se" }).click();
    await expect(phonePage.getByText(/Odkaz už neplatí/)).toBeVisible();
    await phone.close();
  });

  test("neplatný nebo upravený odkaz ukáže stejnou stránku bez prozrazení", async ({ page }) => {
    for (const path of [
      "/prihlaseni/odkaz",
      "/prihlaseni/odkaz?t=nesmysl",
      "/prihlaseni/odkaz?t=",
    ]) {
      await page.goto(app(path));
      await expect(page.getByRole("heading", { level: 1, name: "Odkaz už neplatí" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Požádat o nový kód" })).toHaveAttribute(
        "href",
        "/prihlaseni",
      );
    }
  });
});

test.describe("bez prozrazení existence účtu", () => {
  test("známý a neznámý e-mail dostanou stejnou odpověď, e-mail dorazí jen známému", async ({
    page,
    browser,
  }) => {
    const wedding = await seedWedding();
    const unknown = `nikdo-${wedding.tag}@example.test`;

    await requestCode(page, wedding.adminEmail);
    const knownText = await page.locator("main").innerText();

    const other = await browser.newContext({
      locale: "cs-CZ",
      extraHTTPHeaders: { "x-forwarded-for": "198.51.100.77" },
    });
    const otherPage = await other.newPage();
    await requestCode(otherPage, unknown);
    expect(await otherPage.locator("main").innerText()).toBe(knownText);
    expect(otherPage.url()).toBe(page.url());
    await other.close();

    await waitForMail(wedding.adminEmail);
    await expectNoMail(unknown);

    // ověřit kód neznámému e-mailu nejde, ani když by ho útočník uhodl
    expect(await challengeOf(unknown)).toHaveLength(1);
  });

  test("po pěti žádostech za hodinu je odpověď stejná, ale kód se už neposílá", async ({
    page,
  }) => {
    const wedding = await seedWedding();
    for (let i = 1; i <= 6; i++) {
      await requestCode(page, wedding.adminEmail);
    }
    await waitForMail(wedding.adminEmail, 5);
    await expectNoMail(`${wedding.adminEmail}.neexistuje`, 100);
    expect(readMails(wedding.adminEmail)).toHaveLength(5);
  });

  test("limit IP: obecná odpověď bez prozrazení, který klíč byl překročen", async ({
    page,
    ip,
  }) => {
    const wedding = await seedWedding();
    await exhaustRateLimit("login-request-ip", ip, 20);

    await page.goto(app("/prihlaseni"));
    await page.getByLabel("E-mail").fill(wedding.adminEmail);
    await page.getByRole("button", { name: "Poslat kód" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Zkuste to prosím znovu později.",
    );
    await expect(page).toHaveURL(app("/prihlaseni"));
    await expectNoMail(wedding.adminEmail, 500);
  });

  test("neplatný e-mail ukáže chybu u pole a nic neodešle", async ({ page }) => {
    await page.goto(app("/prihlaseni"));
    await page.getByLabel("E-mail").fill("klara");
    await page.getByRole("button", { name: "Poslat kód" }).click();
    await expect(page.getByLabel("E-mail")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(/Zadejte platný e-mail/)).toBeVisible();
    await expect(page.getByLabel("E-mail")).toBeFocused();
  });
});

test.describe("přihlášení PINem (E2E-09)", () => {
  test("adresa a PIN přihlásí a oznámí to na záložní e-mail", async ({ page }) => {
    const wedding = await seedWedding({ pin: "482915" });
    await page.goto(app("/prihlaseni"));
    await page.getByRole("link", { name: "Přihlásit se PINem" }).click();
    await expect(page).toHaveURL(app("/prihlaseni/pin"));

    // adresa i s doménou a PIN s mezerou (opsaný z papíru)
    await page.getByLabel("Adresa svatebního webu").fill(`${wedding.slug}.se-vezmou.cz`);
    await page.getByLabel("PIN ke správě").fill("482 915");
    await page.getByRole("button", { name: "Přihlásit se PINem" }).click();
    await expectDashboard(page);
    await expect(page.getByText(`${wedding.slug}.localhost`)).toBeVisible();

    const notice = await waitForMail(wedding.backupEmail);
    expect(notice.subject).toBe("Přihlášení PINem do správy vašeho svatebního webu");
    expect(notice.text).toContain(`${wedding.slug}.localhost`);
    expect(notice.text).not.toContain("482915");
    expect((await emailLogFor(wedding.backupEmail))[0]).toMatchObject({
      type: "backup_login_notice",
      recipient_domain: "example.test",
    });
    expect(await sessionsOf(wedding.weddingId)).toHaveLength(1);
  });

  test("pět chyb: pauza 15 minut, upozornění na záložní e-mail, dvojnásobek, nezávislá cesta e-mailem", async ({
    page,
  }) => {
    const wedding = await seedWedding({ pin: "482915" });
    const fail = async (pin: string) => {
      await page.goto(app("/prihlaseni/pin"));
      await page.getByLabel("Adresa svatebního webu").fill(wedding.slug);
      await page.getByLabel("PIN ke správě").fill(pin);
      await submitAndWait(page, "Přihlásit se PINem");
    };

    for (let i = 0; i < 4; i++) {
      await fail("739104");
      await expect(page.locator("main").getByRole("alert")).toContainText(
        "Adresa nebo PIN nesouhlasí.",
      );
    }
    expect(await lockoutsFor(wedding.slug)).toMatchObject({ level: 0, failures: 4 });

    // pátá chyba spustí pauzu 15 minut
    await fail("739104");
    await expect(page.locator("main").getByRole("alert")).toContainText("pozastaveno");
    await expect(page.locator("main").getByRole("alert")).toContainText(/15\s+minut/);
    const first = await lockoutsFor(wedding.slug);
    expect(first!.level).toBe(1);
    expect(first!.remaining).toBeGreaterThan(14 * 60);
    expect(first!.remaining).toBeLessThanOrEqual(15 * 60);

    // upozornění na záložní e-mail
    const warning = await waitForMail(wedding.backupEmail);
    expect(warning.subject).toBe("Opakovaně chybný PIN ke správě vašeho svatebního webu");
    expect(warning.text).toMatch(/15\s+minut/);

    // v pauze neprojde ani správný PIN
    await fail("482915");
    await expect(page.locator("main").getByRole("alert")).toContainText("pozastaveno");
    expect(await sessionsOf(wedding.weddingId)).toHaveLength(0);

    // přihlášení kódem z e-mailu pauza nezablokuje
    await requestCode(page, wedding.adminEmail);
    await submitCode(page, codeOf(await waitForMail(wedding.adminEmail)));
    await expectDashboard(page);
    await page.getByRole("button", { name: "Odhlásit se" }).click();
    await expect(page).toHaveURL(app("/prihlaseni"));

    // po uplynutí pauzy začíná nová série a další pauza je dvojnásobná (30 minut)
    await endLockout(wedding.slug);
    for (let i = 0; i < 5; i++) await fail("739104");
    const second = await lockoutsFor(wedding.slug);
    expect(second!.level).toBe(2);
    expect(second!.remaining).toBeGreaterThan(29 * 60);
    expect(second!.remaining).toBeLessThanOrEqual(30 * 60);
    expect((await waitForMail(wedding.backupEmail, 2)).text).toMatch(/30\s+minut/);

    // po uplynutí pauzy správný PIN přihlásí a vynuluje sérii i úroveň
    await endLockout(wedding.slug);
    await fail("482915");
    await expectDashboard(page);
    expect(await lockoutsFor(wedding.slug)).toBeNull();
  });

  test("nepotvrzená záložní adresa nedostane žádné oznámení (ani o přihlášení, ani o pauze)", async ({
    page,
  }) => {
    const wedding = await seedWedding({ pin: "482915", backupConfirmed: false });
    // každý pokus počká na odpověď serveru: text chyby je po každém pokusu stejný, takže sám nestačí
    for (let i = 0; i < 5; i++) {
      await page.goto(app("/prihlaseni/pin"));
      await page.getByLabel("Adresa svatebního webu").fill(wedding.slug);
      await page.getByLabel("PIN ke správě").fill("739104");
      await submitAndWait(page, "Přihlásit se PINem");
    }
    // pauza po páté chybě platí, jen se o ní nepíše na nepotvrzenou adresu
    await expect(page.locator("main").getByRole("alert")).toContainText("pozastaveno");
    expect(readMails(wedding.backupEmail)).toHaveLength(0);
  });

  test("neznámá adresa dostane stejnou odpověď jako chybný PIN", async ({ page }) => {
    const wedding = await seedWedding({ pin: "482915" });
    const message = async (slug: string) => {
      await page.goto(app("/prihlaseni/pin"));
      await page.getByLabel("Adresa svatebního webu").fill(slug);
      await page.getByLabel("PIN ke správě").fill("739104");
      await page.getByRole("button", { name: "Přihlásit se PINem" }).click();
      await expect(page.locator("main").getByRole("alert")).not.toBeEmpty();
      return page.locator("main").getByRole("alert").innerText();
    };
    const known = await message(wedding.slug);
    const unknown = await message(`neexistuje-${wedding.tag}`);
    expect(unknown).toBe(known);
    expect(known).toContain("Adresa nebo PIN nesouhlasí.");
    // žádný e-mail neznámé svatbě a ani jeden záložní e-mail za dvě chyby
    expect(readMails(wedding.backupEmail)).toHaveLength(0);
  });

  test("svatba bez PINu se chová jako neexistující", async ({ page }) => {
    const wedding = await seedWedding({ pin: null });
    await page.goto(app("/prihlaseni/pin"));
    await page.getByLabel("Adresa svatebního webu").fill(wedding.slug);
    await page.getByLabel("PIN ke správě").fill("482915");
    await page.getByRole("button", { name: "Přihlásit se PINem" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Adresa nebo PIN nesouhlasí.",
    );
    expect(await sessionsOf(wedding.weddingId)).toHaveLength(0);
  });

  test("limit IP pro PIN: po 20 pokusech se ověřování ani nespustí", async ({ page, ip }) => {
    const wedding = await seedWedding({ pin: "482915" });
    await exhaustRateLimit("pin-admin-ip", ip, 20);
    await page.goto(app("/prihlaseni/pin"));
    await page.getByLabel("Adresa svatebního webu").fill(wedding.slug);
    await page.getByLabel("PIN ke správě").fill("482915");
    await page.getByRole("button", { name: "Přihlásit se PINem" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Zkuste to prosím znovu později.",
    );
    expect(await sessionsOf(wedding.weddingId)).toHaveLength(0);
  });
});

test.describe("relace", () => {
  async function login(page: import("@playwright/test").Page, email: string) {
    const before = readMails(email).length;
    await requestCode(page, email);
    await submitCode(page, codeOf(await waitForMail(email, before + 1)));
    await expectDashboard(page);
  }

  test("platí jen pro hostitele app (cookie je host-only)", async ({ page, context }) => {
    const wedding = await seedWedding();
    await login(page, wedding.adminEmail);
    expect((await context.cookies(pageUrl(HOSTS.app, "/"))).map((c) => c.name)).toContain(
      SESSION_COOKIE,
    );
    for (const host of [HOSTS.tenant, HOSTS.admin, HOSTS.marketing, `jiny.${HOSTS.marketing}`]) {
      const names = (await context.cookies(pageUrl(host, "/"))).map((c) => c.name);
      expect(names, host).not.toContain(SESSION_COOKIE);
    }
  });

  test("po nečinnosti (14 dní) a po absolutní platnosti (60 dní) vyprší", async ({ page }) => {
    const wedding = await seedWedding();
    await login(page, wedding.adminEmail);

    await withDb((db) =>
      db.query(
        "update se_vezmou.sessions set idle_expires_at = now() - interval '1 second' where wedding_id = $1",
        [wedding.weddingId],
      ),
    );
    await page.goto(app("/"));
    await expect(page).toHaveURL(app("/prihlaseni"));

    await login(page, wedding.adminEmail);
    await withDb((db) =>
      db.query(
        "update se_vezmou.sessions set absolute_expires_at = now() - interval '1 second', idle_expires_at = now() + interval '1 day' where wedding_id = $1 and revoked_at is null",
        [wedding.weddingId],
      ),
    );
    await page.goto(app("/"));
    await expect(page).toHaveURL(app("/prihlaseni"));
  });

  test("aktivní relace se prodlužuje (klouzavé okno, zápis jen občas)", async ({ page }) => {
    const wedding = await seedWedding();
    await login(page, wedding.adminEmail);
    const [before] = await sessionsOf(wedding.weddingId);

    // čerstvá relace se při dalším požadavku nepřepisuje
    await page.goto(app("/"));
    expect((await sessionsOf(wedding.weddingId))[0].last_seen_at).toEqual(before.last_seen_at);

    await withDb((db) =>
      db.query(
        "update se_vezmou.sessions set last_seen_at = now() - interval '10 minutes', idle_expires_at = now() + interval '1 day' where wedding_id = $1",
        [wedding.weddingId],
      ),
    );
    await page.goto(app("/"));
    const [after] = await sessionsOf(wedding.weddingId);
    expect(+after.idle_expires_at - Date.now()).toBeGreaterThan(13 * 86_400_000);
  });

  test("odebraný správce o relaci přijde", async ({ page }) => {
    const wedding = await seedWedding();
    await login(page, wedding.adminEmail);
    await withDb((db) =>
      db.query("update se_vezmou.wedding_admins set removed_at = now() where id = $1", [
        wedding.adminId,
      ]),
    );
    await page.goto(app("/"));
    await expect(page).toHaveURL(app("/prihlaseni"));
  });

  test("přihlášený uživatel je z přihlašovacích stránek přesměrován do správy", async ({
    page,
  }) => {
    const wedding = await seedWedding();
    await login(page, wedding.adminEmail);
    for (const path of ["/prihlaseni", "/prihlaseni/pin"]) {
      await page.goto(app(path));
      await expect(page).toHaveURL(app("/"));
    }
  });

  test("nová relace po přihlášení odvolá předchozí (bez fixace relace)", async ({ page }) => {
    const wedding = await seedWedding();
    await login(page, wedding.adminEmail);
    await page.getByRole("button", { name: "Odhlásit se" }).click();
    await expect(page).toHaveURL(app("/prihlaseni"));
    await login(page, wedding.adminEmail);
    const rows = await sessionsOf(wedding.weddingId);
    expect(rows).toHaveLength(2);
    expect(rows[0].revoked_at).not.toBeNull();
    expect(rows[1].revoked_at).toBeNull();
  });

  test("stránka odhlášení bez relace vede na přihlášení", async ({ page }) => {
    await page.goto(app("/odhlaseni"));
    await expect(page).toHaveURL(app("/prihlaseni"));
  });
});

test.describe("angličtina", () => {
  test("rozhraní i e-mail pod /en, přihlášení zůstane anglicky", async ({ browser }) => {
    const wedding = await seedWedding();
    const context = await browser.newContext({
      locale: "en-GB",
      extraHTTPHeaders: { "x-forwarded-for": "198.51.100.99" },
    });
    const page = await context.newPage();
    await page.goto(app("/en/prihlaseni"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in to manage your wedding" }),
    ).toBeVisible();
    await page.getByLabel("E-mail").fill(wedding.adminEmail);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.waitForURL(app("/en/prihlaseni/kod"));

    const mail = await waitForMail(wedding.adminEmail);
    expect(mail.subject).toMatch(/^\d{6} is your sign-in code for Se vezmou$/);
    expect(mail.html).toContain('lang="en-GB"');
    expect(mail.html).toContain("/en/prihlaseni/odkaz?t=");
    await page.getByLabel("Six-digit code").fill(codeOf(mail));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(app("/en"));
    await expect(page.getByRole("heading", { level: 1, name: "My website" })).toBeVisible();
    await expect(page.getByTestId("current-wedding")).toContainText(
      /Managing:\s+Klára and\s+Matěj/,
    );
    expect((await emailLogFor(wedding.adminEmail))[0]).toMatchObject({ locale: "en" });
    await context.close();
  });

  test("anglický prohlížeč: vstup na českou adresu vede na /en, volba češtiny pak platí (ADR 0013)", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      locale: "en-GB",
      extraHTTPHeaders: { "x-forwarded-for": "198.51.100.98" },
    });
    const page = await context.newPage();
    await page.goto(app("/prihlaseni"));
    await expect(page).toHaveURL(app("/en/prihlaseni"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");

    await page
      .getByRole("navigation", { name: "Language", exact: true })
      .getByRole("link", { name: "Čeština" })
      .click();
    await expect(page).toHaveURL(app("/prihlaseni"));
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Přihlášení");

    // Česká adresa pak zůstane česky i při novém vstupu (jazyk určuje adresa a volba v cookie).
    await page.goto(app("/prihlaseni"));
    await expect(page).toHaveURL(app("/prihlaseni"));
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
    await context.close();
  });
});
