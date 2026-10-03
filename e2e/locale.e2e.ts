import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { HOSTS, apiRequest, pageUrl } from "./hosts";
import { appUrl, seedManagedSite } from "./support/admin";
import { admin, loginAsOperator, seedOperator } from "./support/ops";

/**
 * Jazyk podle ADR 0013, ve skutečném Chromiu (posílá `Sec-Fetch-*`): vstup na adresu bez předpony
 * s prohlížečem v jiném jazyce přesměruje na `/en`, přepínač jazyka funguje oběma směry a detekce ho
 * nikdy nevrátí (cookie `NEXT_LOCALE` po výslovném přepnutí). Roboti bez `Accept-Language` dostanou
 * češtinu bez přesměrování. Weby párů nepřesměrovávají nikdy.
 */

const COOKIE = "NEXT_LOCALE";

async function englishBrowser(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ locale: "en-GB" });
}

async function localeCookie(context: BrowserContext, host: string): Promise<string | undefined> {
  const cookies = await context.cookies(pageUrl(host, "/"));
  return cookies.find((cookie) => cookie.name === COOKIE)?.value;
}

/** Klik na jazyk v přepínači s daným názvem navigace. */
async function switchTo(page: Page, navigation: string | RegExp, language: string) {
  await page
    .getByRole("navigation", { name: navigation, exact: typeof navigation === "string" })
    .first()
    .getByRole("link", { name: language })
    .click();
}

test.describe("úvodní stránka", () => {
  test("anglický prohlížeč na / skončí na /en, český zůstane na /", async ({ browser }) => {
    const english = await englishBrowser(browser);
    const page = await english.newPage();
    await page.goto(pageUrl(HOSTS.marketing, "/?utm_source=test"));
    await expect(page).toHaveURL(pageUrl(HOSTS.marketing, "/en?utm_source=test"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    // Samotná detekce cookie nezapisuje (jen výslovné přepnutí).
    expect(await localeCookie(english, HOSTS.marketing)).toBeUndefined();
    await english.close();

    const czech = await browser.newContext({ locale: "cs-CZ" });
    const czechPage = await czech.newPage();
    await czechPage.goto(pageUrl(HOSTS.marketing, "/"));
    await expect(czechPage).toHaveURL(pageUrl(HOSTS.marketing, "/"));
    await expect(czechPage.locator("html")).toHaveAttribute("lang", "cs");
    await czech.close();
  });

  test("robot bez Accept-Language a bez cookie dostane češtinu bez přesměrování", async ({
    request,
  }) => {
    const { url, options } = apiRequest(HOSTS.marketing, "/");
    const response = await request.get(url, {
      ...options,
      headers: { ...options.headers, accept: "text/html" },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["location"]).toBeUndefined();
    expect(await response.text()).toContain('lang="cs"');
  });

  test("přesměrování při vstupu se nesdílí v mezipaměti a nese Vary", async ({ request }) => {
    const { url, options } = apiRequest(HOSTS.marketing, "/");
    const response = await request.get(url, {
      ...options,
      headers: { ...options.headers, accept: "text/html", "accept-language": "en-GB,en;q=0.9" },
    });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers()["location"], "http://x").pathname).toBe("/en");
    expect(response.headers()["vary"]).toContain("Accept-Language");
    expect(response.headers()["vary"]).toContain("Cookie");
    expect(response.headers()["cache-control"]).toBe("private, no-store");
  });

  test("anglický prohlížeč: přepnutí na češtinu platí a detekce ho nevrátí", async ({
    browser,
  }) => {
    const context = await englishBrowser(browser);
    const page = await context.newPage();
    await page.goto(pageUrl(HOSTS.marketing, "/en"));

    await switchTo(page, "Language", "Čeština");
    await expect(page).toHaveURL(pageUrl(HOSTS.marketing, "/"));
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
    expect(await localeCookie(context, HOSTS.marketing)).toBe("cs");

    // Nový vstup na / zůstane česky (cookie má přednost před prohlížečem).
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    await expect(page).toHaveURL(pageUrl(HOSTS.marketing, "/"));
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");

    await switchTo(page, "Jazyk", "English");
    await expect(page).toHaveURL(pageUrl(HOSTS.marketing, "/en"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    expect(await localeCookie(context, HOSTS.marketing)).toBe("en");
    await context.close();
  });

  test("přepínač funguje i bez JavaScriptu a na právní stránce vede na překlad cesty", async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: "en-GB", javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(pageUrl(HOSTS.marketing, "/soukromi"));
    await expect(page).toHaveURL(pageUrl(HOSTS.marketing, "/en/privacy"));
    await switchTo(page, "Language", "Čeština");
    await expect(page).toHaveURL(pageUrl(HOSTS.marketing, "/soukromi"));
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
    await page.goto(pageUrl(HOSTS.marketing, "/soukromi"));
    await expect(page).toHaveURL(pageUrl(HOSTS.marketing, "/soukromi"));
    await context.close();
  });
});

test.describe("hostitel app.", () => {
  test("správa (/web): vstup anglicky, přepnutí na češtinu drží, zpět anglicky", async ({
    browser,
  }) => {
    const site = await seedManagedSite();
    const context = await englishBrowser(browser);
    await site.login(context);
    const page = await context.newPage();

    await page.goto(appUrl("/web"));
    await expect(page).toHaveURL(appUrl("/en/web"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");

    await switchTo(page, "Administration language", "Čeština");
    await expect(page).toHaveURL(appUrl("/web"));
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");

    await page.goto(appUrl("/web"));
    await expect(page).toHaveURL(appUrl("/web"));
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");

    await switchTo(page, "Jazyk správy", "English");
    await expect(page).toHaveURL(appUrl("/en/web"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await context.close();
  });

  test("přihlášení: přepínač jazyka na přihlašovací obrazovce", async ({ browser }) => {
    const context = await englishBrowser(browser);
    const page = await context.newPage();
    await page.goto(appUrl("/prihlaseni"));
    await expect(page).toHaveURL(appUrl("/en/prihlaseni"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in to manage your wedding" }),
    ).toBeVisible();

    await switchTo(page, "Language", "Čeština");
    await expect(page).toHaveURL(appUrl("/prihlaseni"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Přihlášení do správy svatby" }),
    ).toBeVisible();

    await page.goto(appUrl("/prihlaseni"));
    await expect(page).toHaveURL(appUrl("/prihlaseni"));

    await switchTo(page, "Jazyk", "English");
    await expect(page).toHaveURL(appUrl("/en/prihlaseni"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await context.close();
  });

  test("průvodce: vstup anglicky, přepnutí na češtinu drží, zpět anglicky", async ({ browser }) => {
    const context = await englishBrowser(browser);
    const page = await context.newPage();
    await page.goto(appUrl("/vytvorit"));
    await expect(page).toHaveURL(appUrl("/en/vytvorit"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");

    await switchTo(page, "Language", "Čeština");
    await expect(page).toHaveURL(appUrl("/vytvorit"));
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");

    await page.goto(appUrl("/vytvorit"));
    await expect(page).toHaveURL(appUrl("/vytvorit"));

    await switchTo(page, "Jazyk", "English");
    await expect(page).toHaveURL(appUrl("/en/vytvorit"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await context.close();
  });
});

test.describe("hostitel admin. (provozní administrace)", () => {
  test("přihlášení i přehled mají /en a přepínač; volba jazyka drží", async ({ browser }) => {
    const operator = await seedOperator({ enrolled: true });
    const context = await englishBrowser(browser);
    const page = await context.newPage();

    await page.goto(admin("/prihlaseni"));
    await expect(page).toHaveURL(admin("/en/prihlaseni"));
    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in to operations administration" }),
    ).toBeVisible();
    await switchTo(page, "Language", "Čeština");
    await expect(page).toHaveURL(admin("/prihlaseni"));
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");

    // Přihlášení česky (volba drží i přes přesměrování), pak přepnutí na přehledu.
    await loginAsOperator(page, operator);
    await switchTo(page, "Jazyk", "English");
    await expect(page).toHaveURL(admin("/en"));
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    // Odkazy nabídky nesou jazyk stránky.
    await page
      .getByRole("navigation", { name: "Operations administration main menu" })
      .getByRole("link", { name: "Orders" })
      .click();
    await expect(page).toHaveURL(admin("/en/zakazky"));
    await switchTo(page, "Language", "Čeština");
    await expect(page).toHaveURL(admin("/zakazky"));
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
    await context.close();
  });
});

test.describe("web páru (jazyky z databáze)", () => {
  test("bez automatického přesměrování; přepínač nabízí jazyky webu a funguje", async ({
    browser,
  }) => {
    const context = await englishBrowser(browser);
    const page = await context.newPage();
    await page.goto(pageUrl(HOSTS.tenant, "/"));
    await expect(page).toHaveURL(pageUrl(HOSTS.tenant, "/"));
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");

    await switchTo(page, "Jazyk", "English");
    await expect(page).toHaveURL(pageUrl(HOSTS.tenant, "/en"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await switchTo(page, "Language", "Čeština");
    await expect(page).toHaveURL(pageUrl(HOSTS.tenant, "/"));
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
    expect(await localeCookie(context, HOSTS.tenant)).toBeUndefined();
    await context.close();
  });
});

test.describe("stránka 404", () => {
  test("nabízí úvod v každém jazyce", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/neexistuje"));
    const nav = page.getByRole("main").getByRole("navigation", { name: "Jazyk" });
    await expect(nav.getByRole("link", { name: "Čeština" })).toHaveAttribute("href", "/");
    await expect(nav.getByRole("link", { name: "English" })).toHaveAttribute("href", "/en");
  });
});
