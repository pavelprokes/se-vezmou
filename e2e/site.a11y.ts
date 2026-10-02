import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { HOSTS, pageUrl } from "./hosts";
import { TAGS, TEMPLATES, VIEWPORTS, previewUrl, type Lang, type Template } from "./site";

/**
 * Přístupnost webu páru: axe (WCAG 2.2 AA) na všech čtyřech šablonách a jejich paletách,
 * v mobilním (375 px) a stolním zobrazení, česky i anglicky. Axe pokryje jen část kritérií,
 * ruční testy zůstávají povinné (docs/test-plan.md).
 */

async function violations(page: import("@playwright/test").Page) {
  // Počkat na titulek: po překreslení stránky (např. po akci serveru) může být na okamžik prázdný a axe by hlásil document-title.
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target),
  }));
}

for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
  for (const lang of ["cs", "en"] as Lang[]) {
    for (const template of Object.keys(TEMPLATES) as Template[]) {
      for (const palette of TEMPLATES[template]) {
        test(`axe: ${template} / ${palette}, ${viewportName}, ${lang}`, async ({ page }) => {
          await page.setViewportSize(viewport);
          await page.goto(previewUrl(lang, { template, palette }));
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          expect(await violations(page)).toEqual([]);
        });
      }
    }
  }
}

test.describe("další stavy webu", () => {
  for (const lang of ["cs", "en"] as Lang[]) {
    test(`axe: odemčené dary a rozbalené FAQ (Chateau, ${lang})`, async ({ page }) => {
      await page.goto(previewUrl(lang, { template: "chateau", unlocked: true }));
      for (const summary of await page.locator("summary").all()) await summary.click();
      expect(await violations(page)).toEqual([]);
    });

    test(`axe: režim poděkování (Modern, ${lang})`, async ({ page }) => {
      await page.goto(previewUrl(lang, { template: "modern", phase: "thanks" }));
      expect(await violations(page)).toEqual([]);
    });

    test(`axe: ukázka Editorial s chybějícími překlady (${lang})`, async ({ page }) => {
      await page.goto(previewUrl(lang, { fixture: "editorial", template: "editorial" }));
      expect(await violations(page)).toEqual([]);
    });

    test(`axe: zavřené potvrzování účasti (Eukalyptus Hloubka, ${lang})`, async ({ page }) => {
      await page.goto(
        previewUrl(lang, { template: "eukalyptus", palette: "hloubka", phase: "rsvp_closed" }),
      );
      expect(await violations(page)).toEqual([]);
    });
  }

  test("axe: web páru na hostiteli webu páru česky i anglicky, mobil", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobil);
    for (const path of ["/", "/en"]) {
      await page.goto(pageUrl(HOSTS.tenant, path));
      expect(await violations(page)).toEqual([]);
    }
  });
});
