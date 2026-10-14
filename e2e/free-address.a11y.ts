import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { pageUrl } from "./hosts";
// Vlastní IP každého testu: stránka volné adresy omezuje počet požadavků podle IP.
import { expect, test } from "./support/fixtures";

/**
 * Přístupnost stránky volné adresy (WCAG 2.2 AA, ADR 0015) v desktopovém i mobilním viewportu
 * (projekty `a11y` a `a11y-mobile`), česky i anglicky, a pokyny, které axe neumí: nadpis, landmark,
 * přeskočení na obsah, viditelné zaměření a obsah bez vodorovného posuvu při 320 px.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const host = (slug: string) => `${slug}.localhost`;

test.use({ reducedMotion: "reduce" });

async function violations(page: Page) {
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target),
  }));
}

for (const { name, path, slug } of [
  { name: "česky", path: "/", slug: "david-a-lil" },
  { name: "anglicky", path: "/en", slug: "david-and-lil" },
  { name: "dlouhá adresa", path: "/", slug: "a".repeat(30) + "-a-" + "b".repeat(30) },
]) {
  test(`axe: volná adresa ${name}`, async ({ page }) => {
    await page.goto(pageUrl(host(slug), path));
    expect(await violations(page)).toEqual([]);
  });
}

test("jedno h1 s adresou, landmark main a přeskočení na obsah", async ({ page }) => {
  await page.goto(pageUrl(host("david-a-lil"), "/"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Přeskočit na obsah" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
});

test("hlavní tlačítko má viditelné zaměření a cíl dotyku aspoň 44 px", async ({ page }) => {
  await page.goto(pageUrl(host("david-a-lil"), "/"));
  const cta = page.getByRole("link", { name: "Vytvořit web na této adrese" });
  await cta.focus();
  const outline = await cta.evaluate((el) => {
    const style = getComputedStyle(el);
    return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);
  const box = await cta.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("při 320 px nevzniká vodorovný posuv, ani s nejdelší adresou", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const longest = "a".repeat(30) + "-a-" + "b".repeat(30);
  for (const slug of ["david-a-lil", longest]) {
    await page.goto(pageUrl(host(slug), "/"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, slug).toBeLessThanOrEqual(0);
  }
});

test("typický slug se vejde na jeden řádek i v úzkém mobilu", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(pageUrl(host("david-a-lil"), "/"));
  const heading = page.getByRole("heading", { level: 1 });
  const lines = await heading.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  });
  expect(lines).toBe(1);
});
