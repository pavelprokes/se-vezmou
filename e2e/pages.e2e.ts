import { expect, test } from "@playwright/test";
import { NBSP } from "../src/i18n/typo";
import { HOSTS, PORT, pageUrl } from "./hosts";

test.describe("úvodní stránka a jazyky", () => {
  test("čeština na /: lang, nadpis, hreflang a canonical", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
    await expect(page.getByRole("heading", { level: 1, name: /^Vaše svatba/ })).toBeVisible();

    const alternates = await page
      .locator('link[rel="alternate"][hreflang]')
      .evaluateAll((links) =>
        Object.fromEntries(links.map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")])),
      );
    // Next.js zapisuje kořen bez koncového lomítka; jde o tutéž adresu.
    expect(alternates).toEqual({
      cs: "https://se-vezmou.cz",
      en: "https://se-vezmou.cz/en",
      "x-default": "https://se-vezmou.cz",
    });
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://se-vezmou.cz",
    );
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  });

  test("angličtina pod /en: lang en-GB a canonical na sebe", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/en"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Your wedding/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://se-vezmou.cz/en",
    );
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
      "href",
      "https://se-vezmou.cz",
    );
  });

  test("bez automatického přesměrování podle jazyka prohlížeče", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-GB" });
    const page = await context.newPage();
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
    await context.close();
  });

  test("přepínač jazyka je navigace s odkazy a funguje oběma směry", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    const nav = page.getByRole("navigation", { name: "Jazyk", exact: true });
    await expect(nav.getByRole("link", { name: "Čeština" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await nav.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(pageUrl(HOSTS.marketing, "/en"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");

    await page
      .getByRole("navigation", { name: "Language", exact: true })
      .getByRole("link", { name: "Čeština" })
      .click();
    await expect(page).toHaveURL(pageUrl(HOSTS.marketing, "/"));
  });

  test("odkaz Přeskočit na obsah je první při Tab a přesune zaměření na obsah", async ({
    page,
  }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Přeskočit na obsah" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#obsah")).toBeFocused();
  });

  test("typografie: jednopísmenná předložka za sebou nese nezlomitelnou mezeru", async ({
    page,
  }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    const lead = await page.locator("#obsah p", { hasText: "praktické" }).first().innerText();
    expect(lead).toContain(`i${NBSP}praktické`);
  });
});

test.describe("písma z vlastního hostingu", () => {
  test("stránka nevolá žádnou třetí stranu", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (!["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol.startsWith("http")) {
        external.push(request.url());
      }
    });
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
    });
    await page.goto(pageUrl(HOSTS.marketing, "/"), { waitUntil: "networkidle" });
    expect(external).toEqual([]);
    expect(violations).toEqual([]);
  });

  test("písma Newsreader a DM Sans se načtou z /_next/static", async ({ page }) => {
    const fonts: string[] = [];
    page.on("response", (response) => {
      if (/\.woff2?$/.test(response.url())) fonts.push(response.url());
    });
    await page.goto(pageUrl(HOSTS.marketing, "/"), { waitUntil: "networkidle" });
    expect(fonts.length).toBeGreaterThan(0);
    for (const url of fonts) expect(url).toContain(`:${PORT}/_next/static/`);
    const families = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family);
    });
    expect(families.join(" ")).toMatch(/Newsreader/);
    expect(families.join(" ")).toMatch(/DM Sans/);
  });
});

test.describe("Vercel Analytics a Speed Insights", () => {
  // Mimo Vercel skripty `/_vercel/*` neexistují (servíruje je platforma); ověřujeme, že se vkládají
  // ze stejného původu, který povoluje CSP (`script-src 'self'`), a že weby párů je nemají.
  test("úvodní stránka vkládá skripty ze stejného původu", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    await expect(page.locator('script[src="/_vercel/insights/script.js"]')).toHaveCount(1);
    await expect(page.locator('script[src="/_vercel/speed-insights/script.js"]')).toHaveCount(1);
  });

  test("web páru měření nemá (soukromí hostů)", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.tenant, "/"), { waitUntil: "networkidle" });
    await expect(page.locator('script[src*="/_vercel/"]')).toHaveCount(0);
  });
});

test.describe("placeholdery ostatních hostitelů", () => {
  test("app a admin mají noindex v hlavičce i v meta", async ({ page }) => {
    for (const host of [HOSTS.app, HOSTS.admin]) {
      const response = await page.goto(pageUrl(host, "/"));
      expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        "noindex, nofollow",
      );
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });

  test("web páru Klára a Matěj (fixtura) je neindexovatelný", async ({ page }) => {
    const response = await page.goto(pageUrl(HOSTS.tenant, "/"));
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Klára & Matěj");
  });

  test("web páru v angličtině", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.tenant, "/en"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Klára & Matěj");
    await expect(page.getByRole("link", { name: "RSVP" }).first()).toBeVisible();
  });

  test("404 neexistujícího webu páru je stejná stránka bez slugu", async ({ page }) => {
    const first = await page.goto(pageUrl("neexistuje.localhost", "/"));
    expect(first?.status()).toBe(404);
    const second = await page.goto(pageUrl("klara-a-matej.localhost", "/neexistuje"));
    expect(second?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stránka nenalezena");
    expect(await page.content()).not.toContain("neexistuje.localhost");
  });

  test("404 stránka úvodní stránky v češtině i angličtině", async ({ page }) => {
    const cs = await page.goto(pageUrl(HOSTS.marketing, "/nic"));
    expect(cs?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stránka nenalezena");
    const en = await page.goto(pageUrl(HOSTS.marketing, "/en/nic"));
    expect(en?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
  });
});
