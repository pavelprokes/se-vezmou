import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { codeOf, linkOf, waitForMail } from "./support/mail";
import { seedWedding } from "./support/db";
import { app, expect, requestCode, submitAndWait, test } from "./support/fixtures";

/**
 * Přístupnost obrazovek přihlášení (WCAG 2.2 AA, M4): axe na každém kroku včetně chybových stavů,
 * ovládání klávesnicí, zaměření chyby, cíle dotyku a reflow. Ruční testy (NVDA, správce hesel,
 * MAN-08) zůstávají povinné, viz docs/test-plan.md.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

test.describe("axe: obrazovky přihlášení", () => {
  test("e-mail, i s chybou", async ({ page }) => {
    await page.goto(app("/prihlaseni"));
    await expectNoViolations(page);
    await page.getByLabel("E-mail").fill("klara");
    await page.getByRole("button", { name: "Poslat kód" }).click();
    await expect(page.getByText(/Zadejte platný e-mail/)).toBeVisible();
    await expectNoViolations(page);
  });

  test("kód, i s chybou", async ({ page }) => {
    const wedding = await seedWedding();
    await requestCode(page, wedding.adminEmail);
    await expectNoViolations(page);
    await page.getByLabel("Šestimístný kód").fill("12");
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await expect(page.getByLabel("Šestimístný kód")).toHaveAttribute("aria-invalid", "true");
    await expectNoViolations(page);
    await page.getByLabel("Šestimístný kód").fill("000000");
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await expect(page.getByText(/Kód nesouhlasí nebo už neplatí/)).toBeVisible();
    await expectNoViolations(page);
  });

  test("odkaz: potvrzení i neplatný odkaz", async ({ page }) => {
    const wedding = await seedWedding();
    await requestCode(page, wedding.adminEmail);
    await page.goto(linkOf(await waitForMail(wedding.adminEmail)));
    await expect(
      page.getByRole("heading", { level: 1, name: "Potvrďte přihlášení" }),
    ).toBeVisible();
    await expectNoViolations(page);
    await page.goto(app("/prihlaseni/odkaz?t=neplatny"));
    await expectNoViolations(page);
  });

  test("PIN, i s chybou a pauzou", async ({ page }) => {
    const wedding = await seedWedding({ pin: "482915" });
    await page.goto(app("/prihlaseni/pin"));
    await expectNoViolations(page);
    for (let i = 0; i < 5; i++) {
      await page.getByLabel("Adresa svatebního webu").fill(wedding.slug);
      await page.getByLabel("PIN ke správě").fill("739104");
      await submitAndWait(page, "Přihlásit se PINem");
      await expect(page.locator("main").getByRole("alert")).not.toBeEmpty();
      if (i === 0) await expectNoViolations(page);
    }
    await expect(page.locator("main").getByRole("alert")).toContainText("pozastaveno");
    await expectNoViolations(page);
  });

  test("přehled po přihlášení a odhlášení", async ({ page }) => {
    const wedding = await seedWedding();
    await requestCode(page, wedding.adminEmail);
    await page.getByLabel("Šestimístný kód").fill(codeOf(await waitForMail(wedding.adminEmail)));
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Správa svatby" })).toBeVisible();
    await expectNoViolations(page);
    await page.goto(app("/odhlaseni"));
    await expect(page.getByRole("heading", { level: 1, name: "Odhlášení" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("angličtina", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-GB" });
    const page = await context.newPage();
    await page.goto(app("/prihlaseni"));
    await expectNoViolations(page);
    await page.goto(app("/prihlaseni/pin"));
    await expectNoViolations(page);
    await context.close();
  });
});

test.describe("ovládání a zobrazení", () => {
  test("formulář jde vyplnit a odeslat jen klávesnicí, pole mají viditelný popisek", async ({
    page,
  }) => {
    const wedding = await seedWedding();
    await page.goto(app("/prihlaseni"));
    await page.keyboard.press("Tab"); // odkaz Přeskočit na obsah
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("E-mail")).toBeFocused();
    await page.keyboard.type(wedding.adminEmail);
    await page.keyboard.press("Enter");
    await page.waitForURL(app("/prihlaseni/kod"));
    await expect(page.getByLabel("Šestimístný kód")).toBeVisible();
    await expect(page.locator("label", { hasText: "Šestimístný kód" })).toBeVisible();
  });

  test("viditelný focus a cíle dotyku nejméně 44 px", async ({ page }) => {
    await page.goto(app("/prihlaseni/pin"));
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      const outline = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement as HTMLElement);
        return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
      });
      expect(outline.style).not.toBe("none");
      expect(outline.width).toBeGreaterThanOrEqual(2);
    }
    const boxes = await page
      .locator("main button:visible, main a:visible, main input:visible")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { text: el.textContent?.trim() || el.getAttribute("name"), height: r.height };
        }),
      );
    expect(boxes.length).toBeGreaterThan(3);
    for (const box of boxes) expect(box.height, `${box.text}`).toBeGreaterThanOrEqual(44);
  });

  test("šířka 320 px: žádné vodorovné posouvání (WCAG 1.4.10)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ["/prihlaseni", "/prihlaseni/pin", "/prihlaseni/odkaz?t=x"]) {
      await page.goto(app(path));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("stránky mají vlastní nadpis stránky (title)", async ({ page }) => {
    const titles: Record<string, string> = {
      "/prihlaseni": "Přihlášení do správy svatby | Se vezmou",
      "/prihlaseni/pin": "Přihlášení PINem | Se vezmou",
      "/prihlaseni/odkaz": "Potvrďte přihlášení | Se vezmou",
    };
    for (const [path, title] of Object.entries(titles)) {
      await page.goto(app(path));
      await expect(page).toHaveTitle(title);
    }
  });
});
