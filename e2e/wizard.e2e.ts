import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import type { Page } from "@playwright/test";
import { eukalyptusFixture } from "../src/site/fixtures/klara-a-matej";
import { HOSTS, PORT, pageUrl } from "./hosts";
import { exhaustRateLimit, randomIp, seedPublishedSite, uniqueTag, withDb } from "./support/db";
import { expect, test } from "./support/fixtures";
import {
  completeRequiredSteps,
  fillOptionalSteps,
  heading,
  isCompact,
  next,
  nextScreen,
  siteUrl,
  verifyEmail,
  wizardUrl,
} from "./support/wizard";

/**
 * Průvodce (M5): celá cesta od jmen po zveřejnění na mobilním i počítačovém viewportu, koncept bez
 * účtu, přeskočení kroků, kolize adresy, vypršení rezervace, náhled konceptu, PDF oznámení.
 * Běží proti skutečnému PostgreSQL (`DB_TRANSPORT=pg`), e-maily se čtou z outboxu.
 */

// Plynulé posouvání by klikání mimo obraz zdržovalo; jde o chování, ne o vzhled.
test.use({ reducedMotion: "reduce" });

async function rows<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return withDb(async (db) => (await db.query<T>(sql, params)).rows);
}

/** Přejde na krok přes ukazatel postupu (na mobilu v rozbalovacím seznamu). */
async function openStep(page: Page, name: RegExp | string) {
  if (isCompact(page)) {
    await page.getByText("Všechny kroky").click();
  }
  await page
    .getByRole("navigation", { name: "Postup průvodce" })
    .getByRole("button", { name })
    .first()
    .click();
}

/** Přeskočí kroky 4 až 8 a skončí na kroku 9. */
async function skipOptionalSteps(page: Page) {
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: "Přeskočit", exact: true }).click();
  await expect(heading(page)).toHaveText("Uložit, nebo zveřejnit?");
}

function emails(tag: string) {
  return { email: `par-${tag}@example.test`, backup: `zaloha-${tag}@example.test` };
}

test.describe("E2E-01: průvodce od jmen po zveřejnění", () => {
  test("bez účtu do kroku 3, pak zveřejnění, Hotovo, web na subdoméně a PDF", async ({
    page,
    browser,
  }) => {
    const tag = uniqueTag();
    const slug = `e2e-w1-${tag}`;
    const mail = emails(tag);

    await completeRequiredSteps(page, { slug });

    // Do kroku 3 nevznikl ani účet, ani rezervace adresy: koncept je jen v prohlížeči.
    expect(await rows("select 1 from se_vezmou.weddings where slug = $1", [slug])).toHaveLength(0);
    expect(
      await rows("select 1 from se_vezmou.slug_registry where slug = $1", [slug]),
    ).toHaveLength(0);
    expect(
      await rows("select 1 from se_vezmou.wedding_admins where email = $1", [mail.email]),
    ).toHaveLength(0);

    const { pin } = await fillOptionalSteps(page);
    await expect(page.getByTestId("review-ok")).toBeVisible();

    // Živý náhled používá komponenty webu páru s daty z konceptu.
    if (isCompact(page)) {
      await page.getByRole("button", { name: "Náhled" }).click();
    }
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.getByRole("heading", { level: 1 })).toContainText("Klára");
    await expect(preview.getByText("Zámecká kaple").first()).toBeVisible();
    if (isCompact(page)) await page.getByRole("button", { name: "Zavřít náhled" }).click();

    await next(page);
    await expect(heading(page)).toHaveText("Uložit, nebo zveřejnit?");
    await page.getByRole("button", { name: "Zveřejnit web", exact: true }).click();
    await verifyEmail(page, mail);

    // Hotovo: adresa, QR kód, PIN a PDF.
    const done = page.getByTestId("done");
    await expect(done).toBeVisible({ timeout: 20_000 });
    await expect(heading(page)).toHaveText("Hotovo, váš web je na světě!");
    await expect(page.getByTestId("done-address")).toHaveText(`${slug}.localhost:${PORT}`);
    await expect(page.getByRole("img", { name: /QR kód s adresou webu/ })).toBeVisible();
    await expect(page.getByTestId("done-pin")).toHaveText(pin);
    // obrazovka Hotovo je v hlavní oblasti, na kterou míří odkaz přeskočení (WCAG 2.4.1); PIN čtečka dostane po číslicích
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.locator("main#obsah")).toContainText(slug);
    await expect(page.getByRole("main").getByText(pin.split("").join(" "))).toBeAttached();

    // Databáze: web je zveřejněný, adresa trvale přidělená, PIN jen jako hash.
    const wedding = await rows<{
      status: string;
      guest_pin_enabled: boolean;
      pin_hash: string | null;
      draft_pin: string;
      version_no: number;
      slug_state: string;
      first_published_at: Date | null;
    }>(
      `select w.status, w.guest_pin_enabled, wa.guest_pin_hash as pin_hash,
              w.wizard_draft -> 'guestPin' ->> 'pin' as draft_pin,
              (select max(version_no) from se_vezmou.site_versions v where v.wedding_id = w.id) as version_no,
              sr.state as slug_state, sr.first_published_at
         from se_vezmou.weddings w
         join se_vezmou.wedding_auth wa on wa.wedding_id = w.id
         join se_vezmou.slug_registry sr on sr.slug = w.slug
        where w.slug = $1`,
      [slug],
    );
    expect(wedding).toHaveLength(1);
    expect(wedding[0]).toMatchObject({
      status: "published",
      guest_pin_enabled: true,
      version_no: 1,
      slug_state: "active",
      draft_pin: "",
    });
    expect(wedding[0].pin_hash).toMatch(/^\$argon2id\$/);
    expect(wedding[0].first_published_at).not.toBeNull();

    // Zveřejněný web se otevře na subdoméně *.localhost s obsahem z průvodce.
    const guest = await (await browser.newContext()).newPage();
    const response = await guest.goto(siteUrl(slug));
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await expect(guest.getByRole("heading", { level: 1 })).toHaveText("Klára & Matěj");
    await expect(guest).toHaveTitle("Klára a Matěj");
    const nav = guest.getByRole("navigation", { name: "Navigace po stránce" });
    for (const name of ["Program", "Místo", "Ubytování", "Kontakt"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    await expect(guest.getByText("Zámecká kaple").first()).toBeVisible();
    await expect(guest.getByText("Penzion U Řeky")).toBeVisible();
    await expect(guest.getByText("Slavnostní, bez bílé.")).toBeVisible();
    await guest.context().close();

    // PDF oznámení k tisku: jedna stránka, titulek s jmény, platný soubor.
    const download = page.waitForEvent("download");
    await page.getByTestId("done-pdf").click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`oznameni-${slug}.pdf`);
    const bytes = readFileSync(await file.path());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toContain("Klára & Matěj");

    // Měření: události bez osobních údajů.
    const events = await rows<{ event: string }>(
      "select distinct event from se_vezmou.analytics_event where event in ('wizard_started', 'wizard_step_completed', 'site_published')",
    );
    expect(events.map((e) => e.event).sort()).toEqual([
      "site_published",
      "wizard_started",
      "wizard_step_completed",
    ]);
  });
});

test.describe("E2E-02: přeskočení kroků 4 až 8 a návrat", () => {
  test("kroky 4 až 8 jdou přeskočit, vrátit se k nim a doplnit", async ({ page }) => {
    const tag = uniqueTag();
    await completeRequiredSteps(page, { slug: `e2e-w2-${tag}` });
    await expect(page.getByTestId("step-counter")).toContainText("Krok 4 z 9");

    await skipOptionalSteps(page);
    await expect(page.getByTestId("step-counter")).toContainText("Krok 9 z 9");

    // Krok 9 nabízí uložení i zveřejnění, i když se nic nevyplnilo.
    await expect(page.getByRole("button", { name: "Zveřejnit web", exact: true })).toBeEnabled();

    // Návrat na přeskočený krok a doplnění dress code.
    await openStep(page, /Praktické informace/);
    await expect(heading(page)).toHaveText("Co by hosté měli vědět");
    await page.getByLabel("Dress code").fill("Slavnostní");
    await expect(page.getByTestId("step-counter")).toContainText("Krok 5 z 9");

    // Zpět na dokončený krok 2 a znovu dopředu: nic se neztratilo.
    await openStep(page, /Datum a adresa/);
    await expect(page.getByLabel("Datum svatby")).toHaveValue("2027-06-19");
    await openStep(page, /Praktické informace/);
    await expect(page.getByLabel("Dress code")).toHaveValue("Slavnostní");

    // Tlačítko Zpět vrací o krok.
    await page.getByRole("button", { name: "Zpět", exact: true }).click();
    if (isCompact(page)) {
      await expect(page.getByTestId("step-counter")).toContainText("Krok 4 z 9");
    } else {
      await expect(page.getByTestId("step-counter")).toContainText("Krok 4 z 9");
    }
  });

  test("přeskočit zbývající kroky z kroku 4 vede rovnou k uložení", async ({ page }) => {
    await completeRequiredSteps(page, { slug: `e2e-w2b-${uniqueTag()}` });
    await page.getByRole("button", { name: /Přeskočit zbývající kroky/ }).click();
    await expect(heading(page)).toHaveText("Uložit, nebo zveřejnit?");
  });
});

test.describe("E2E-03: průběžné ukládání v prohlížeči", () => {
  test("obnovení stránky i nové okno prohlížeče nezahodí rozepsaná data", async ({
    page,
    context,
  }) => {
    await page.goto(wizardUrl());
    await page.getByLabel("První jméno").fill("Barbora");
    await page.getByLabel("Druhé jméno").fill("Tomáš");
    await nextScreen(page);
    await next(page);
    await page.getByLabel("Datum svatby").fill("2027-09-04");
    // krátká prodleva ukládání do úložiště
    await expect(page.getByTestId("save-status")).toContainText("jen v tomto prohlížeči");
    await page.waitForTimeout(500);

    await page.reload();
    await expect(page.getByTestId("step-counter")).toContainText("Krok 2 z 9");
    await expect(page.getByLabel("Datum svatby")).toHaveValue("2027-09-04");

    // „Zavření prohlížeče“: nová karta ve stejném profilu.
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(wizardUrl());
    await expect(reopened.getByTestId("step-counter")).toContainText("Krok 2 z 9");
    await expect(reopened.getByLabel("Datum svatby")).toHaveValue("2027-09-04");
    await openStep(reopened, /Jména a jazyk/);
    await expect(reopened.getByLabel("První jméno")).toHaveValue("Barbora");
    await expect(reopened.getByLabel("Druhé jméno")).toHaveValue("Tomáš");
  });

  test("jména a jazyk z úvodní stránky předvyplní průvodce a navrhnou adresu", async ({ page }) => {
    await page.goto(wizardUrl("?jmeno1=Zuzana&jmeno2=Ondřej&jazyk=cs"));
    await expect(page.getByLabel("První jméno")).toHaveValue("Zuzana");
    await expect(page.getByLabel("Druhé jméno")).toHaveValue("Ondřej");
    await nextScreen(page);
    await next(page);
    await nextScreen(page);
    await expect(page.getByLabel("Adresa webu")).toHaveValue("zuzana-a-ondrej");
  });
});

test.describe("E2E-04: kolize adresy", () => {
  test("nabídne varianty, pár nepřijde o data a adresa se rezervuje až při prvním uložení", async ({
    page,
  }) => {
    const tag = uniqueTag();
    const taken = `kolize-${tag}`;
    const mail = emails(tag);
    await seedPublishedSite({ slug: taken, content: { ...eukalyptusFixture, slug: taken } });

    await page.goto(wizardUrl());
    await page.getByLabel("První jméno").fill("Klára");
    await page.getByLabel("Druhé jméno").fill("Matěj");
    await nextScreen(page);
    await next(page);
    await page.getByLabel("Datum svatby").fill("2027-06-19");
    await nextScreen(page);
    await page.getByLabel("Adresa webu").fill(taken);
    // Živá kontrola je jen informativní a nic neprozradí: stejný text jako u rezervovaného slova.
    await expect(page.getByTestId("slug-status")).toHaveText(/není\sk\sdispozici/);
    await page.getByLabel("Adresa webu").fill("admin");
    await expect(page.getByTestId("slug-status")).toHaveText(/není\sk\sdispozici/);
    await page.getByLabel("Adresa webu").fill("kurva-a-matej");
    await expect(page.getByTestId("slug-status")).toHaveText(/není\sk\sdispozici/);
    await page.getByLabel("Adresa webu").fill(taken);
    await expect(page.getByTestId("slug-status")).toHaveText(/není\sk\sdispozici/);

    await next(page);
    await nextScreen(page);
    await next(page);
    await skipOptionalSteps(page);
    await page.getByRole("button", { name: "Uložit koncept", exact: true }).click();
    // Rezervace adresy proběhne až po ověření e-mailu (kód z e-mailu).
    expect(
      await rows(
        "select 1 from se_vezmou.slug_registry where wedding_id is not null and slug like $1",
        [`${taken}-%`],
      ),
    ).toHaveLength(0);
    await verifyEmail(page, mail);

    // Kolize: průvodce vrátí pár k adrese, nabídne varianty a nic neztratí.
    const conflict = page.getByTestId("slug-conflict");
    await expect(conflict).toBeVisible({ timeout: 20_000 });
    await expect(heading(page)).toHaveText("Kdy a kde najdou hosté váš web?");
    const variants = conflict.getByRole("radio");
    await expect(variants).toHaveCount(4);
    await expect(conflict.getByText(`${taken}-2027.localhost:${PORT}`)).toBeVisible();
    await expect(conflict.getByText(`${taken}-2027-06.localhost:${PORT}`)).toBeVisible();
    await expect(conflict.getByText(`${taken}-obec.localhost:${PORT}`)).toBeVisible();
    await expect(conflict.getByText(/náhodnými znaky/)).toBeVisible();
    expect(
      await rows("select 1 from se_vezmou.wedding_admins where email = $1", [mail.email]),
    ).toHaveLength(0);

    // Rok v adrese prozradí rok svatby: pár na to upozorníme.
    await conflict.getByRole("radio", { name: new RegExp(`${taken}-2027\\.`) }).check();
    await expect(page.getByRole("note").filter({ hasText: "adresa obsahuje rok" })).toBeVisible();

    // Varianta bez roku; data jsou v pořádku a uložení projde bez dalšího kódu (e-mail už je ověřený).
    await conflict.getByRole("radio", { name: new RegExp(`${taken}-obec\\.`) }).check();
    await expect(page.getByLabel("Adresa webu")).toHaveValue(`${taken}-obec`);
    await expect(page.getByRole("note").filter({ hasText: "adresa obsahuje rok" })).toHaveCount(0);
    await openStep(page, /Jména a jazyk/);
    await expect(page.getByLabel("První jméno")).toHaveValue("Klára");
    await openStep(page, /Uložit nebo zveřejnit/);
    await page.getByRole("button", { name: "Uložit koncept", exact: true }).click();
    await expect(page.getByTestId("preview-link")).toBeVisible({ timeout: 20_000 });

    const saved = await rows<{ status: string; slug: string; state: string }>(
      `select w.status, w.slug, sr.state from se_vezmou.weddings w
         join se_vezmou.slug_registry sr on sr.wedding_id = w.id
         join se_vezmou.wedding_admins a on a.wedding_id = w.id
        where a.email = $1`,
      [mail.email],
    );
    expect(saved).toEqual([{ status: "draft", slug: `${taken}-obec`, state: "reserved" }]);
  });
});

test.describe("E2E-05: vypršení rezervace konceptu", () => {
  test("po vypršení se adresa uvolní, jiný pár ji získá a původní pár o data nepřijde", async ({
    page,
    browser,
  }) => {
    const tag = uniqueTag();
    const slug = `e2e-w5-${tag}`;
    const mail = emails(tag);

    await completeRequiredSteps(page, { slug });
    await skipOptionalSteps(page);
    await page.getByRole("button", { name: "Uložit koncept", exact: true }).click();
    await verifyEmail(page, mail);
    await expect(page.getByTestId("preview-link")).toBeVisible({ timeout: 20_000 });
    // Pár odejde od počítače (okno se zavře dřív, než by se koncept sám znovu uložil).
    const context = page.context();
    await page.close();

    // Rezervace vyprší (30 dní bez aktivity) a denní úklid adresu uvolní.
    await withDb(async (db) => {
      await db.query(
        "update se_vezmou.slug_registry set reserved_until = now() - interval '1 day' where slug = $1",
        [slug],
      );
      await db.query("set role service_role");
      await db.query("select se_vezmou.purge_expired_slug_reservations()");
    });
    const released = await rows<{ slug: string | null }>(
      "select slug from se_vezmou.weddings w join se_vezmou.wedding_admins a on a.wedding_id = w.id where a.email = $1",
      [mail.email],
    );
    expect(released).toEqual([{ slug: null }]);

    // Jiný pár si stejnou adresu vezme (vlastní profil prohlížeče, bez sdíleného konceptu).
    const otherTag = uniqueTag();
    const other = await (
      await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } })
    ).newPage();
    await completeRequiredSteps(other, { slug, a: "Jana", b: "Petr" });
    await skipOptionalSteps(other);
    await other.getByRole("button", { name: "Uložit koncept", exact: true }).click();
    await verifyEmail(other, emails(otherTag));
    await expect(other.getByTestId("preview-link")).toBeVisible({ timeout: 20_000 });
    await other.context().close();

    // Původní pár se vrátí: koncept s jmény je celý, adresa se nabídne znovu s variantami.
    const back = await context.newPage();
    await back.goto(wizardUrl());
    await expect(back.getByTestId("step-counter")).toContainText("Krok 9 z 9");
    await openStep(back, /Datum a adresa/);
    await back.getByLabel("Datum svatby").fill("2027-06-20");
    await nextScreen(back);
    await expect(back.getByTestId("slug-conflict")).toBeVisible({ timeout: 20_000 });
    await expect(back.getByTestId("slug-conflict").getByRole("radio")).toHaveCount(4);
    const original = await rows<{ partner_a_name: string; starts_on: string }>(
      "select w.partner_a_name, w.starts_on::text from se_vezmou.weddings w join se_vezmou.wedding_admins a on a.wedding_id = w.id where a.email = $1",
      [mail.email],
    );
    expect(original[0].partner_a_name).toBe("Klára");
    expect(original[0].starts_on).toBe("2027-06-20");
  });
});

test.describe("E2E-06: koncept a odkaz na náhled", () => {
  test("neveřejný koncept s neuhádnutelným odkazem, noindex, nový odkaz zneplatní starý", async ({
    page,
    browser,
  }) => {
    const tag = uniqueTag();
    const slug = `e2e-w6-${tag}`;
    await completeRequiredSteps(page, { slug });
    await skipOptionalSteps(page);
    await page.getByRole("button", { name: "Uložit koncept", exact: true }).click();
    await verifyEmail(page, emails(tag));

    const input = page.getByTestId("preview-link-input");
    await expect(input).toBeVisible({ timeout: 20_000 });
    const link = await input.inputValue();
    expect(link).toMatch(
      new RegExp(`^http://${slug}\\.localhost:${PORT}/nahled/[A-Za-z0-9_-]{43}$`),
    );

    // Web ještě není zveřejněný: veřejná adresa vrací stejnou 404 jako neexistující web.
    const guest = await (await browser.newContext()).newPage();
    const publicResponse = await guest.goto(siteUrl(slug));
    const missing = await guest.goto(siteUrl(`neexistuje-${tag}`));
    expect(publicResponse?.status()).toBe(404);
    expect(missing?.status()).toBe(404);

    // Odkaz na náhled ukáže koncept, neindexovatelně a bez ukládání do mezipaměti.
    const preview = await guest.goto(link);
    expect(preview?.status()).toBe(200);
    expect(preview?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(preview?.headers()["cache-control"]).toBe("private, no-store");
    expect(preview?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(guest.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(guest.getByText("Náhled neveřejného konceptu")).toBeVisible();
    await expect(guest).toHaveTitle("Náhled konceptu");
    await expect(guest.getByRole("heading", { level: 1 })).toHaveText("Klára & Matěj");

    // Poškozený token a token jiné adresy: stejná 404.
    const wrong = await guest.goto(link.replace(/.$/, (c) => (c === "A" ? "B" : "A")));
    expect(wrong?.status()).toBe(404);
    const otherSlug = link.replace(slug, `neexistuje-${tag}`);
    expect((await guest.goto(otherSlug))?.status()).toBe(404);

    // Databáze drží jen hash tokenu.
    const stored = await rows<{ preview_token_hash: Buffer }>(
      "select preview_token_hash from se_vezmou.weddings where slug = $1",
      [slug],
    );
    const token = link.split("/").pop() ?? "";
    expect(stored[0].preview_token_hash).toHaveLength(32);
    expect(stored[0].preview_token_hash.toString("utf8")).not.toContain(token);

    // Nový odkaz zneplatní starý.
    await page.getByRole("button", { name: "Vytvořit nový odkaz" }).click();
    await expect.poll(async () => input.inputValue()).not.toBe(link);
    const fresh = await input.inputValue();
    expect((await guest.goto(link))?.status()).toBe(404);
    expect((await guest.goto(fresh))?.status()).toBe(200);
    await guest.context().close();
  });
});

test.describe("angličtina a odkaz z úvodní stránky", () => {
  test("/en/vytvorit je anglicky a jazyk webu se předvyplní", async ({ page }) => {
    await page.goto(wizardUrl("", "en"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await expect(heading(page)).toHaveText("Who is getting married?");
    await page.getByLabel("First name").fill("Anna");
    await page.getByLabel("Second name").fill("Tom");
    await nextScreen(page);
    await expect(page.getByRole("checkbox", { name: "English" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Czech" })).not.toBeChecked();
    await next(page);
    await nextScreen(page);
    await expect(page.getByLabel("Website address")).toHaveValue("anna-and-tom");
  });

  test("česká adresa s jazykem en přesměruje na anglickou variantu a zachová jména", async ({
    page,
  }) => {
    await page.goto(pageUrl(HOSTS.app, "/vytvorit?jmeno1=Anna&jmeno2=Tom&jazyk=en"));
    await expect(page).toHaveURL(/\/en\/vytvorit\?jmeno1=Anna&jmeno2=Tom&jazyk=en$/);
    await expect(page.getByLabel("First name")).toHaveValue("Anna");
  });

  test("formulář s jmény na úvodní stránce vede do průvodce s předvyplněnými jmény", async ({
    page,
  }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    const form = page.getByRole("form").first();
    await form.getByLabel("První jméno").fill("Iva");
    await form.getByLabel("Druhé jméno").fill("Jan");
    await form.getByRole("button").click();
    await expect(page).toHaveURL(/app\.localhost.*\/vytvorit\?.*jmeno1=Iva/);
    await expect(page.getByLabel("První jméno")).toHaveValue("Iva");
    await expect(page.getByLabel("Druhé jméno")).toHaveValue("Jan");
  });
});

test.describe("kontrola adresy: omezení počtu dotazů", () => {
  test("po vyčerpání limitu průvodce dostupnost neprozradí a adresu ověří až uložení", async ({
    page,
    ip,
  }) => {
    await exhaustRateLimit("slug-check-ip", ip, 61, 600);
    await page.goto(wizardUrl("?jmeno1=Eva&jmeno2=Adam"));
    await nextScreen(page);
    await next(page);
    await nextScreen(page);
    await expect(page.getByTestId("slug-status")).toHaveText(/Kontrola adres je teď omezená/, {
      timeout: 15_000,
    });
  });
});

test.describe("web páru: neexistující, nezveřejněná a blokovaná adresa", () => {
  test("všechny tři dají stejnou 404", async ({ request }) => {
    const tag = uniqueTag();
    const blocked = `blokovany-${tag}`;
    await seedPublishedSite({
      slug: blocked,
      content: { ...eukalyptusFixture, slug: blocked },
      status: "blocked",
    });
    const draft = `koncept-${tag}`;
    await withDb(async (db) => {
      await db.query("begin");
      await db.query("set constraints all deferred");
      const id = crypto.randomUUID();
      await db.query(
        "insert into se_vezmou.weddings (id, partner_a_name, partner_b_name) values ($1, 'A', 'B')",
        [id],
      );
      await db.query(
        "insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until) values ($1, 'reserved', $2, now() + interval '30 days')",
        [draft, id],
      );
      await db.query("update se_vezmou.weddings set slug = $1 where id = $2", [draft, id]);
      await db.query("commit");
    });

    const get = async (slug: string, path = "/") => {
      const response = await request.get(`http://127.0.0.1:${PORT}${path}`, {
        headers: { host: `${slug}.localhost:${PORT}` },
        maxRedirects: 0,
      });
      return {
        status: response.status(),
        // Skripty s RSC payloadem nesou adresu z hostitele a jejich členění závisí na souběhu
        // požadavků; viditelné HTML musí být stejné.
        body: (await response.text())
          .replace(/<script[\s\S]*?<\/script>/g, "")
          .replaceAll(slug, "ADRESA"),
        robots: response.headers()["x-robots-tag"],
      };
    };
    const [missing, notPublished, blockedSite] = await Promise.all([
      get(`neexistuje-${tag}`),
      get(draft),
      get(blocked),
    ]);
    expect(missing.status).toBe(404);
    expect(notPublished).toEqual({ ...missing });
    expect(blockedSite).toEqual({ ...missing });
    const en = await Promise.all([
      get(`neexistuje-${tag}`, "/en"),
      get(draft, "/en"),
      get(blocked, "/en"),
    ]);
    expect(en[0].status).toBe(404);
    expect(en[1]).toEqual(en[0]);
    expect(en[2]).toEqual(en[0]);
  });
});

test.describe("přístupnost rámce průvodce", () => {
  test("pevný spodní pruh nezakrývá zaměřený prvek při 320 px a písmu 200 % (WCAG 2.4.11, 1.4.10)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(wizardUrl(""));
    await expect(heading(page)).toHaveText("Kdo se bere?");
    await page.getByLabel("První jméno").fill("Klára");

    const bar = page.getByTestId("wizard-bar");
    await expect(bar).toBeVisible();
    // odsazení posunu stránky je aspoň tak velké jako pruh, jinak by pod něj zaměření zajelo
    const sizes = await page.evaluate(() => ({
      padding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
      bar: document.querySelector<HTMLElement>('[data-testid="wizard-bar"]')!.offsetHeight,
    }));
    expect(sizes.padding).toBeGreaterThanOrEqual(sizes.bar);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    // písmo 200 % zvětší i pruh, odsazení posunu je v `rem`, takže roste spolu s ním
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const scaled = await page.evaluate(() => ({
      padding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
      bar: document.querySelector<HTMLElement>('[data-testid="wizard-bar"]')!.offsetHeight,
    }));
    expect(scaled.padding).toBeGreaterThanOrEqual(scaled.bar);

    // Tabulátorem dopředu i zpět: žádný zaměřený prvek mimo pruh nesmí zajet pod něj.
    const covered = async () =>
      page.evaluate(() => {
        const barEl = document.querySelector<HTMLElement>('[data-testid="wizard-bar"]')!;
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body || barEl.contains(el)) return null;
        const box = el.getBoundingClientRect();
        const top = barEl.getBoundingClientRect().top;
        return box.bottom > top + 1 ? `${el.tagName} ${el.id}: ${box.bottom} > ${top}` : null;
      });
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      expect(await covered(), `Tab ${i}`).toBeNull();
    }
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await covered(), `Shift+Tab ${i}`).toBeNull();
    }
  });

  test("bez JavaScriptu je zpráva o načítání i o potřebě JavaScriptu v hlavní oblasti s cílem přeskočení", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(wizardUrl(""));
    const main = page.getByRole("main");
    await expect(main).toHaveCount(1);
    await expect(main).toHaveAttribute("id", "obsah");
    await expect(main).toContainText("Načítáme váš koncept");
    // obsah `<noscript>` Playwright do textu nezapočítá, proto se čte zdrojové HTML hlavní oblasti
    expect(await main.innerHTML()).toContain("potřebuje zapnutý JavaScript");
    await expect(page.getByRole("link", { name: "Přeskočit na obsah" })).toBeAttached();
    await context.close();
  });
});
