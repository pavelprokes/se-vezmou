import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { HOSTS, pageUrl } from "./hosts";

/**
 * Přístupnost úvodní stránky (WCAG 2.2 AA) v desktopovém i mobilním viewportu
 * (projekty `a11y` a `a11y-mobile`) a ve stavech, které se ukážou až po interakci:
 * rozbalené FAQ, otevřená mobilní nabídka, chyby formuláře čekací listiny.
 */

test.use({ reducedMotion: "reduce" });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function violations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target),
  }));
}

const pages = [
  { name: "česky", path: "/" },
  { name: "anglicky", path: "/en" },
  { name: "soukromí česky", path: "/soukromi" },
  { name: "privacy anglicky", path: "/en/privacy" },
  { name: "podmínky", path: "/podminky" },
  { name: "dostupnost", path: "/dostupnost" },
];

for (const { name, path } of pages) {
  test(`axe: úvodní web ${name}`, async ({ page }) => {
    await page.goto(pageUrl(HOSTS.marketing, path));
    expect(await violations(page)).toEqual([]);
  });
}

for (const { name, path } of [pages[0], pages[1]]) {
  test(`axe: ${name}, FAQ celé rozbalené`, async ({ page }) => {
    await page.goto(pageUrl(HOSTS.marketing, path));
    for (const summary of await page.locator("#faq summary").all()) await summary.click();
    await expect(page.locator("#faq details[open]")).toHaveCount(6);
    expect(await violations(page)).toEqual([]);
  });

  test(`axe: ${name}, chyby formuláře čekací listiny`, async ({ page }) => {
    await page.goto(pageUrl(HOSTS.marketing, path));
    const form = page.locator("#waitlist form");
    await form.locator('input[type="email"]').fill("neni-email");
    await form.locator('button[type="submit"]').click();
    await expect(form.locator('input[type="email"]')).toHaveAttribute("aria-invalid", "true");
    expect(await violations(page)).toEqual([]);
  });

  test(`axe: ${name}, potvrzení čekací listiny`, async ({ page }) => {
    await page.goto(pageUrl(HOSTS.marketing, path));
    const form = page.locator("#waitlist form");
    await form.locator('input[type="email"]').fill("par@example.com");
    await form.locator('input[name="consent"]').check();
    await form.locator('button[type="submit"]').click();
    await expect(form.getByRole("status")).not.toBeEmpty();
    expect(await violations(page)).toEqual([]);
  });

  test(`axe: ${name}, otevřená navigace (na mobilu po klepnutí na Nabídka)`, async ({
    page,
    isMobile,
  }) => {
    await page.goto(pageUrl(HOSTS.marketing, path));
    if (isMobile) {
      await page.getByRole("button", { name: /^(Nabídka|Menu)$/ }).click();
      await expect(
        page.getByRole("navigation", { name: /Hlavní navigace|Main navigation/ }),
      ).toBeVisible();
    }
    expect(await violations(page)).toEqual([]);
  });
}
