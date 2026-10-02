import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { HOSTS, pageUrl } from "./hosts";

/**
 * Automatická kontrola přístupnosti (WCAG 2.2 AA) na všech zástupných stránkách a v katalogu
 * UI primitiv. Axe pokryje jen část kritérií; ruční testy zůstávají povinné (docs/test-plan.md).
 */
const pages = [
  { name: "úvodní stránka česky", host: HOSTS.marketing, path: "/" },
  { name: "úvodní stránka anglicky", host: HOSTS.marketing, path: "/en" },
  { name: "404 úvodní stránky", host: HOSTS.marketing, path: "/neexistuje" },
  { name: "404 úvodní stránky anglicky", host: HOSTS.marketing, path: "/en/neexistuje" },
  { name: "katalog UI česky", host: HOSTS.marketing, path: "/ui-catalog" },
  { name: "katalog UI anglicky", host: HOSTS.marketing, path: "/en/ui-catalog" },
  { name: "app", host: HOSTS.app, path: "/" },
  { name: "admin", host: HOSTS.admin, path: "/" },
  { name: "web páru česky", host: HOSTS.tenant, path: "/" },
  { name: "web páru anglicky", host: HOSTS.tenant, path: "/en" },
  { name: "404 webu páru", host: "neexistuje.localhost", path: "/" },
];

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const { name, host, path } of pages) {
  test(`axe: ${name}`, async ({ page }) => {
    await page.goto(pageUrl(host, path));
    // Počkat na titulek: po překreslení stránky (např. po akci serveru) může být na okamžik prázdný a axe by hlásil document-title.
    await expect(page).toHaveTitle(/.+/);
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  });
}

test("katalog UI: axe s rozbalenými položkami a chybovým stavem", async ({ page }) => {
  await page.goto(pageUrl(HOSTS.marketing, "/ui-catalog"));
  for (const summary of await page.locator("summary").all()) await summary.click();
  // Počkat na titulek: po překreslení stránky (např. po akci serveru) může být na okamžik prázdný a axe by hlásil document-title.
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations).toEqual([]);
});

test.describe("zaměření a reflow", () => {
  test("viditelný focus: ovladatelný prvek má při zaměření obrys", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/ui-catalog"));
    // První Tab je odkaz Přeskočit na obsah, další odkazy a tlačítka následují.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const outline = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const style = getComputedStyle(el);
        return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
      });
      expect(outline.style).not.toBe("none");
      expect(outline.width).toBeGreaterThanOrEqual(2);
    }
  });

  test("cíle dotyku mají alespoň 44 px", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/ui-catalog"));
    const targets = page.locator("button:visible, nav a:visible, main a:visible, summary:visible");
    const boxes = await targets.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent?.trim(), width: r.width, height: r.height };
      }),
    );
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.height, `${box.text}`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${box.text}`).toBeGreaterThanOrEqual(44);
    }
  });

  test("šířka 320 px: žádné vodorovné posouvání (WCAG 1.4.10)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ["/", "/en", "/ui-catalog"]) {
      await page.goto(pageUrl(HOSTS.marketing, path));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("prefers-reduced-motion vypne přechody", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(pageUrl(HOSTS.marketing, "/ui-catalog"));
    const duration = await page
      .getByRole("button", { name: "Hlavní tlačítko" })
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duration)).toBeLessThan(0.001);
    await context.close();
  });
});
