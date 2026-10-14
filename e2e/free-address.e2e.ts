import { eukalyptusFixture } from "../src/site/fixtures/klara-a-matej";
import type { APIRequestContext, Page } from "@playwright/test";
import { HOSTS, PORT, apiRequest, pageUrl } from "./hosts";
import { dayIso, next, nextScreen } from "./support/wizard";
import { exhaustRateLimit, seedPublishedSite, seedWedding, uniqueTag, withDb } from "./support/db";
// Vlastní IP každého testu: stránka volné adresy omezuje počet požadavků podle IP.
import { expect, test } from "./support/fixtures";

/**
 * Stránka volné adresy (ADR 0015): `<slug>.se-vezmou.cz`, na které nikdo nemá web, ukáže vstup do průvodce.
 * Všechno ostatní (zabraná, rezervovaná, zamčená, blokovaná, vyhrazená i neplatná adresa, podstránky) zůstává
 * stejná 404 jako dosud (FR-PRIV-3).
 */

const FREE = "david-and-lil";
const host = (slug: string) => `${slug}.localhost`;

function get(request: APIRequestContext, ip: string, slug: string, path = "/") {
  const { url, options } = apiRequest(host(slug), path);
  return request.get(url, { ...options, headers: { ...options.headers, "x-forwarded-for": ip } });
}

test.describe("volná adresa", () => {
  test("česky: 200, nadpis s adresou, odkaz na průvodce, noindex a žádné ukládání do mezipaměti", async ({
    page,
  }) => {
    const response = await page.goto(pageUrl(host(FREE), "/"));
    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(headers["cache-control"]).toMatch(/no-store/);
    expect(headers["referrer-policy"]).toBe("no-referrer");

    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
    await expect(page).toHaveTitle(/david-and-lil\.localhost.* je volná/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${FREE}.localhost:${PORT}`);
    await expect(page.getByRole("main")).toContainText("Tato adresa je volná.");
    await expect(page.getByRole("main")).toContainText("Volná");

    // meta robots, bez canonical, hreflang, náhledu odkazu a strukturovaných dat
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('link[rel="alternate"]')).toHaveCount(0);
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(0);
    // soukromí hostů: žádné měření ani skripty třetích stran
    await expect(page.locator('script[src*="/_vercel/"]')).toHaveCount(0);

    // adresa se nezalomí a stránka nemá vodorovný posuv
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const cta = page.getByRole("link", { name: "Vytvořit web na této adrese" });
    await expect(cta).toHaveCount(1);
    const url = new URL((await cta.getAttribute("href")) ?? "");
    expect(url.origin).toBe(`http://app.localhost:${PORT}`);
    expect(url.pathname).toBe("/vytvorit");
    expect(url.searchParams.get("adresa")).toBe(FREE);
    // `-and-` v české stránce není česká spojka: jména se nepředvyplní
    expect(url.searchParams.has("jmeno1")).toBe(false);
    expect(url.searchParams.get("jazyk")).toBe("cs");

    await expect(page.getByRole("list", { name: "Postup" }).getByRole("listitem")).toHaveCount(3);
  });

  test("anglicky na /en: vlastní text, jména z adresy a průvodce v angličtině", async ({
    page,
  }) => {
    const response = await page.goto(pageUrl(host(FREE), "/en"));
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${FREE}.localhost:${PORT}`);
    await expect(page.getByRole("main")).toContainText("This address is available.");
    await expect(page).toHaveTitle(/is available/);

    const cta = page.getByRole("link", { name: "Create a site at this address" });
    const url = new URL((await cta.getAttribute("href")) ?? "");
    expect(url.pathname).toBe("/en/vytvorit");
    expect(url.searchParams.get("adresa")).toBe(FREE);
    expect(url.searchParams.get("jmeno1")).toBe("David");
    expect(url.searchParams.get("jmeno2")).toBe("Lil");
    expect(url.searchParams.get("jazyk")).toBe("en");
  });

  test("česká spojka na české stránce předvyplní jména", async ({ page }) => {
    await page.goto(pageUrl(host("david-a-lil"), "/"));
    const cta = page.getByRole("link", { name: "Vytvořit web na této adrese" });
    const url = new URL((await cta.getAttribute("href")) ?? "");
    expect(url.searchParams.get("jmeno1")).toBe("David");
    expect(url.searchParams.get("jmeno2")).toBe("Lil");
  });

  test("přepínač jazyka vede na anglickou verzi a zpět", async ({ page }) => {
    await page.goto(pageUrl(host(FREE), "/"));
    await page.getByRole("navigation", { name: "Jazyk" }).getByRole("link", { name: /EN/ }).click();
    await expect(page).toHaveURL(pageUrl(host(FREE), "/en"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await page
      .getByRole("navigation", { name: "Language" })
      .getByRole("link", { name: /CS/ })
      .click();
    await expect(page).toHaveURL(pageUrl(host(FREE), "/"));
  });

  test("tlačítko otevře průvodce s předvyplněnou adresou, kterou psaní jmen nepřepíše", async ({
    page,
  }) => {
    const slug = `volna-${uniqueTag()}`;
    await page.goto(pageUrl(host(slug), "/"));
    await page.getByRole("link", { name: "Vytvořit web na této adrese" }).click();
    await expect(page).toHaveURL(new RegExp(`^http://app\\.localhost:${PORT}/vytvorit\\?`));
    await page.getByLabel("První jméno").fill("Klára");
    await page.getByLabel("Druhé jméno").fill("Matěj");
    await nextScreen(page);
    await next(page);
    await page.getByLabel("Datum svatby").fill(dayIso);
    await nextScreen(page);
    await expect(page.getByLabel("Adresa webu")).toHaveValue(slug);
  });

  test("odkaz na ukázky šablon vede na úvodní stránku", async ({ page }) => {
    await page.goto(pageUrl(host(FREE), "/"));
    const href = await page
      .getByRole("link", { name: "Podívat se na ukázky šablon" })
      .getAttribute("href");
    expect(new URL(href ?? "").pathname).toBe("/sablony");
  });

  test("podstránky volné adresy jsou 404", async ({ request, ip }) => {
    for (const path of [
      "/program",
      "/p/abcdef",
      "/nahled/" + "a".repeat(43),
      "/upozorneni",
      "/media/00000000-0000-4000-8000-000000000000/640",
      "/en/program",
      "/og",
    ]) {
      const response = await get(request, ip, FREE, path);
      expect(response.status(), path).toBe(404);
    }
  });
});

test.describe("ostatní adresy zůstávají 404 (FR-PRIV-3)", () => {
  async function bodyOf(page: Page, slug: string) {
    const response = await page.goto(pageUrl(host(slug), "/"));
    expect(response?.status(), slug).toBe(404);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stránka nenalezena");
    return page.locator("main").innerText();
  }

  test("rezervovaná (rozpracovaná) adresa, vyhrazené slovo a neplatný tvar mají stejnou 404", async ({
    page,
  }) => {
    const wedding = await seedWedding();
    const reference = await bodyOf(page, "staging");
    expect(await bodyOf(page, wedding.slug)).toBe(reference);
    expect(await bodyOf(page, "test")).toBe(reference);
    expect(await bodyOf(page, "kurva-a-matej")).toBe(reference);
  });

  test("zveřejněný web se chová jako dosud", async ({ page }) => {
    const response = await page.goto(pageUrl(HOSTS.tenant, "/"));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Klára & Matěj");
    await expect(page.getByText("Tato adresa je volná")).toHaveCount(0);
  });

  test("zablokovaný web nemá stránku volné adresy", async ({ page }) => {
    const slug = `blok-${uniqueTag()}`;
    await seedPublishedSite({
      slug,
      status: "blocked",
      content: { ...eukalyptusFixture, slug, locales: ["cs"], defaultLocale: "cs" },
    });
    const response = await page.goto(pageUrl(host(slug), "/"));
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Tato adresa je volná")).toHaveCount(0);
  });

  test("zamčený web ukáže bránu, ne stránku volné adresy", async ({ page }) => {
    const slug = `zamek-${uniqueTag()}`;
    const { weddingId } = await seedPublishedSite({
      slug,
      content: { ...eukalyptusFixture, slug, locales: ["cs"], defaultLocale: "cs" },
    });
    await withDb((db) =>
      db.query("update se_vezmou.weddings set site_locked = true where id = $1", [weddingId]),
    );
    await page.goto(pageUrl(host(slug), "/"));
    await expect(page.getByText("Tato adresa je volná")).toHaveCount(0);
  });

  test("jazyk, který web nenabízí, je 404 a ne stránka volné adresy", async ({ request, ip }) => {
    const slug = `jazyk-${uniqueTag()}`;
    await seedPublishedSite({
      slug,
      content: { ...eukalyptusFixture, slug, locales: ["cs"], defaultLocale: "cs" },
    });
    const response = await get(request, ip, slug, "/en");
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain("is available");
  });
});

test.describe("omezení počtu požadavků (ADR 0010)", () => {
  test("po vyčerpání limitu podle IP je odpověď stejná 404, ne stránka volné adresy", async ({
    request,
    ip,
  }) => {
    expect((await get(request, ip, FREE)).status()).toBe(200);
    await exhaustRateLimit("free-address-ip", ip, 25, 600);
    const limited = await get(request, ip, FREE);
    expect(limited.status()).toBe(404);
    expect(limited.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(await limited.text()).not.toContain("Tato adresa je volná");
  });

  test("neplatný tvar ani vyhrazené slovo limit nespotřebují", async ({ request, ip }) => {
    for (let i = 0; i < 30; i++) {
      expect((await get(request, ip, "test")).status()).toBe(404);
    }
    expect((await get(request, ip, FREE)).status()).toBe(200);
  });
});
