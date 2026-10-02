import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { apiRequest, HOSTS } from "./hosts";
import { tenant } from "./rsvp";
import { randomIp, withDb } from "./support/db";
import {
  endGuestLockout,
  GUEST_PIN,
  guestLockouts,
  guestSessions,
  SENSITIVE,
  WEDDING_ID,
} from "./support/rsvp-db";
import { expect, test } from "./support/rsvp-fixtures";

/**
 * PIN hostů a odemykání citlivých bloků (E2E-17, FR-PRIV-2): číslo účtu, QR platba a adresa
 * soukromého místa. Bez PINu se citlivá data nedostanou do HTML ani do RSC payloadu; chybný PIN
 * i neexistující PIN dávají stejnou odpověď; po pěti chybách je pauza; relace hosta je host-only
 * cookie s krátkou platností a nepustí do správy.
 */

const WRONG = "135790";
const LEAKS = [SENSITIVE.account, SENSITIVE.holder, SENSITIVE.address, SENSITIVE.directions];

async function enterPin(page: Page, region: string, pin: string): Promise<void> {
  const scope = page.locator(region);
  await scope.getByLabel("PIN z pozvánky").fill(pin);
  const response = page.waitForResponse((r) => r.request().method() === "POST");
  await scope.getByRole("button", { name: "Odemknout" }).click();
  await response;
  // React po dokončení akce vyprázdní formulář; další psaní smí začít až potom (jinak by ho smazal)
  await expect(async () => {
    // evaluateAll nečeká na prvek, který se právě odstraňuje (odemčení formulář nahradí obsahem)
    const values = await scope
      .getByLabel("PIN z pozvánky")
      .evaluateAll((fields) => fields.map((field) => (field as HTMLInputElement).value));
    expect(values.every((value) => value === "")).toBe(true);
  }).toPass();
}

/**
 * Tok RSC stránky tak, jak ho čte klientský router při navigaci (`RSC: 1`, `Next-Url`). Čte se
 * z prohlížeče: hostitele webu páru zná jen on a nese i jeho cookie.
 */
async function rscPayload(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch(`${location.pathname}?_rsc=test`, {
      headers: { RSC: "1", "Next-Url": location.pathname },
    });
    if (!response.ok) throw new Error(`RSC ${response.status}`);
    return response.text();
  });
}

test.describe("citlivá data bez PINu (E2E-17)", () => {
  test("číslo účtu, QR, majitel ani adresa soukromého místa nejsou v HTML ani v RSC payloadu", async ({
    page,
    request,
    wedding,
  }) => {
    await wedding({ guestPin: GUEST_PIN });
    const { url, options } = apiRequest(HOSTS.tenant, "/");

    // dokument (včetně RSC streamu vloženého do HTML), česky i anglicky
    const html = await (await request.get(url, options)).text();
    const english = await (await request.get(apiRequest(HOSTS.tenant, "/en").url, options)).text();
    for (const body of [html, english]) {
      for (const secret of LEAKS) expect(body).not.toContain(secret);
      expect(body).not.toContain("CZ");
      expect(body).not.toMatch(/SPD\*1\.0/);
    }
    expect(html).toMatch(/PIN z\spozvánky/);
    expect(html).toContain("self.__next_f"); // payload je součástí dokumentu, tedy zkontrolovaný

    // zástupné formuláře jsou vidět v prohlížeči a nic odemčeného
    await page.goto(tenant("/"));
    await expect(page.locator("#dary").getByLabel("PIN z pozvánky")).toBeVisible();
    await expect(page.locator("#misto").getByLabel("PIN z pozvánky")).toBeVisible();
    await expect(page.locator("svg.site-qr")).toHaveCount(0);
    const content = await page.content();
    for (const secret of LEAKS) expect(content).not.toContain(secret);

    // samostatný tok RSC, který čte klientský router (neprázdný, jinak by test nic nehlídal)
    const rsc = await rscPayload(page);
    expect(rsc.length).toBeGreaterThan(10_000);
    expect(rsc).toContain("Potvrdit účast");
    for (const secret of LEAKS) expect(rsc).not.toContain(secret);
    expect(rsc).not.toMatch(/SPD\*1\.0/);
  });

  test("po zadání PINu jsou data v dokumentu i v RSC (kontrola, že test únik pozná)", async ({
    page,
    context,
    request,
    wedding,
  }) => {
    await wedding({ guestPin: GUEST_PIN });
    await page.goto(tenant("/"));
    await enterPin(page, "#dary", GUEST_PIN);
    await expect(page.locator("#dary")).toContainText(SENSITIVE.account);

    const rsc = await rscPayload(page);
    expect(rsc).toContain(SENSITIVE.account);
    expect(rsc).toContain(SENSITIVE.address);

    const cookie = (await context.cookies(tenant("/"))).find((c) => c.name === "sv_guest")!;
    const { url, options } = apiRequest(HOSTS.tenant, "/");
    const html = await (
      await request.get(url, {
        headers: { ...options.headers, cookie: `sv_guest=${cookie.value}` },
      })
    ).text();
    expect(html).toContain(SENSITIVE.account);
    expect(html).toContain(SENSITIVE.address);
  });
});

test.describe("zadání PINu hostů (E2E-17, FR-PRIV-2)", () => {
  test("správný PIN odemkne dary i soukromé místo, relace je host-only a krátká", async ({
    page,
    context,
    wedding,
  }) => {
    await wedding({ guestPin: GUEST_PIN });
    await page.goto(tenant("/"));

    // PIN s mezerami (opsání z pozvánky) se přijme
    await enterPin(page, "#dary", `${GUEST_PIN.slice(0, 3)} ${GUEST_PIN.slice(3)}`);

    const gifts = page.locator("#dary");
    await expect(gifts.getByText(SENSITIVE.account)).toBeVisible();
    await expect(gifts.getByText(SENSITIVE.holder)).toBeVisible();
    await expect(
      gifts.getByRole("img", { name: /QR kód pro platbu na účet 2501234567\/2010/ }),
    ).toBeVisible();
    // formulář zmizel a zaměření přešlo na odemčený obsah (ne na odstraněné tlačítko)
    await expect(gifts.getByLabel("PIN z pozvánky")).toHaveCount(0);
    await expect(gifts.getByRole("group", { name: "Odemčeno PINem." })).toBeFocused();
    // soukromé místo se odemklo stejnou relací
    const venue = page.getByRole("article", { name: "Soukromý altán" });
    await expect(venue.getByText(SENSITIVE.address)).toBeVisible();
    await expect(venue.getByText(SENSITIVE.directions)).toBeVisible();
    await expect(venue.getByLabel("PIN z pozvánky")).toHaveCount(0);

    // cookie: HttpOnly, SameSite=Lax, bez Domain, krátká platnost
    const cookie = (await context.cookies(tenant("/"))).find((c) => c.name === "sv_guest")!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: false });
    expect(cookie.domain).toBe(HOSTS.tenant);
    expect(cookie.domain.startsWith(".")).toBe(false);
    const lifetime = cookie.expires - Date.now() / 1000;
    expect(Math.round(lifetime / 3600)).toBe(48);
    expect(await page.evaluate(() => document.cookie)).not.toContain("sv_guest");

    // databáze: relace hosta, jen hash tokenu, bez subjektu, nečinnost 6 h a absolutně 2 dny
    const [session] = await guestSessions();
    expect(session).toMatchObject({ kind: "guest_pin", subject_id: null, revoked_at: null });
    expect(session.token_hash).toBe(createHash("sha256").update(cookie.value).digest("hex"));
    expect(session.token_hash).not.toContain(cookie.value);
    expect(Math.round((+session.idle_expires_at - +session.last_seen_at) / 3_600_000)).toBe(6);
    expect(Math.round((+session.absolute_expires_at - +session.last_seen_at) / 3_600_000)).toBe(48);

    // obnovení stránky: stále odemčeno, bez nového zadání PINu; jiný prohlížeč zamčený
    await page.reload();
    await expect(page.locator("#dary").getByText(SENSITIVE.account)).toBeVisible();
    const other = await page.context().browser()!.newContext({ locale: "cs-CZ" });
    const otherPage = await other.newPage();
    await otherPage.goto(tenant("/"));
    await expect(otherPage.locator("#dary").getByLabel("PIN z pozvánky")).toBeVisible();
    await expect(otherPage.locator("#dary")).not.toContainText(SENSITIVE.account);
    await other.close();
  });

  test("relace hosta nepustí do správy a odvolaná či prošlá relace odemčení ukončí", async ({
    page,
    context,
    request,
    wedding,
  }) => {
    await wedding({ guestPin: GUEST_PIN });
    await page.goto(tenant("/"));
    await enterPin(page, "#dary", GUEST_PIN);
    await expect(page.locator("#dary").getByText(SENSITIVE.account)).toBeVisible();
    const cookie = (await context.cookies(tenant("/"))).find((c) => c.name === "sv_guest")!;

    // token hosta vydávaný za relaci správce: přihlášení správy ho nepřijme
    const app = apiRequest(HOSTS.app, "/");
    const response = await request.get(app.url, {
      headers: { ...app.options.headers, cookie: `sv_admin=${cookie.value}` },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/prihlaseni");

    // relace prošla (nečinnost): citlivé bloky se zamknou
    await withDb((db) =>
      db.query(
        "update public.sessions set idle_expires_at = now() - interval '1 second' where wedding_id = $1 and kind = 'guest_pin'",
        [WEDDING_ID],
      ),
    );
    await page.reload();
    await expect(page.locator("#dary").getByLabel("PIN z pozvánky")).toBeVisible();
    await expect(page.locator("#dary")).not.toContainText(SENSITIVE.account);

    // nové zadání vydá novou relaci; odvolání (změna PINu) ji zruší
    await enterPin(page, "#dary", GUEST_PIN);
    await expect(page.locator("#dary").getByText(SENSITIVE.account)).toBeVisible();
    await withDb((db) =>
      db.query(
        "update public.sessions set revoked_at = now() where wedding_id = $1 and kind = 'guest_pin'",
        [WEDDING_ID],
      ),
    );
    await page.reload();
    await expect(page.locator("#dary").getByLabel("PIN z pozvánky")).toBeVisible();
  });

  test("chybný PIN: chyba slovy u pole, nic se neodemkne, špatný tvar se nepočítá", async ({
    page,
    wedding,
  }) => {
    const w = await wedding({ guestPin: GUEST_PIN });
    await page.goto(tenant("/"));
    const gifts = page.locator("#dary");

    await enterPin(page, "#dary", "123");
    await expect(gifts.getByText("PIN má aspoň šest číslic.")).toBeVisible();
    expect(await guestLockouts(w.ip)).toHaveLength(0);

    await enterPin(page, "#dary", WRONG);
    await expect(gifts.getByText(/PIN nesouhlasí\. Zkontrolujte ho na pozvánce/)).toBeVisible();
    await expect(gifts.getByLabel("PIN z pozvánky")).toHaveAttribute("aria-invalid", "true");
    await expect(gifts.getByLabel("PIN z pozvánky")).toBeFocused();
    await expect(gifts.getByLabel("PIN z pozvánky")).toHaveValue("");
    await expect(gifts).not.toContainText(SENSITIVE.account);
    expect(await guestSessions()).toHaveLength(0);
  });

  test("pět chyb spustí pauzu, správný PIN v pauze nepomůže, ostatní hosté nejsou postiženi", async ({
    page,
    browser,
    wedding,
  }) => {
    const w = await wedding({ guestPin: GUEST_PIN });
    await page.goto(tenant("/"));
    const gifts = page.locator("#dary");

    for (let i = 0; i < 4; i++) {
      await enterPin(page, "#dary", WRONG);
      await expect(gifts.getByText(/PIN nesouhlasí/)).toBeVisible();
    }
    await enterPin(page, "#dary", WRONG);
    await expect(
      gifts.getByText("Zadávání PINu je dočasně pozastaveno. Zkuste to znovu za 15 minut."),
    ).toBeVisible();

    const [lock] = (await guestLockouts(w.ip)).filter((l) => l.level > 0);
    expect(lock).toMatchObject({ level: 1 });

    // v pauze neodemkne ani správný PIN a odpověď je stejná jako při chybě
    await enterPin(page, "#dary", GUEST_PIN);
    await expect(gifts.getByText(/Zadávání PINu je dočasně pozastaveno/)).toBeVisible();
    await expect(gifts).not.toContainText(SENSITIVE.account);
    expect(await guestSessions()).toHaveLength(0);

    // jiná IP (jiný host na téže svatbě) pauzou postižená není
    const second = await browser.newContext({
      locale: "cs-CZ",
      extraHTTPHeaders: { "x-forwarded-for": randomIp() },
    });
    const otherPage = await second.newPage();
    await otherPage.goto(tenant("/"));
    await enterPin(otherPage, "#dary", WRONG);
    await expect(otherPage.locator("#dary").getByText(/PIN nesouhlasí/)).toBeVisible();
    await enterPin(otherPage, "#dary", GUEST_PIN);
    await expect(otherPage.locator("#dary").getByText(SENSITIVE.account)).toBeVisible();
    await second.close();

    // po skončení pauzy správný PIN funguje a čítače se vynulují
    await endGuestLockout(w.ip);
    await enterPin(page, "#dary", GUEST_PIN);
    await expect(gifts.getByText(SENSITIVE.account)).toBeVisible();
    expect(await guestLockouts(w.ip)).toHaveLength(0);
  });

  test("svatba bez PINu hostů: jakýkoli PIN dává stejnou chybu a stejnou pauzu", async ({
    page,
    wedding,
  }) => {
    const w = await wedding({ guestPin: null });
    await page.goto(tenant("/"));
    const gifts = page.locator("#dary");

    await enterPin(page, "#dary", GUEST_PIN);
    await expect(gifts.getByText(/PIN nesouhlasí/)).toBeVisible();
    for (let i = 0; i < 4; i++) await enterPin(page, "#dary", WRONG);
    await expect(gifts.getByText(/Zadávání PINu je dočasně pozastaveno/)).toBeVisible();
    expect((await guestLockouts(w.ip)).some((l) => l.level === 1)).toBe(true);
    expect(await guestSessions()).toHaveLength(0);
  });
});
