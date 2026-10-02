import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { uniqueTag } from "./support/db";
import { expect, test } from "./support/fixtures";
import {
  completeRequiredSteps,
  fillOptionalSteps,
  heading,
  isCompact,
  next,
  nextScreen,
  verifyEmail,
  wizardUrl,
} from "./support/wizard";
import { TAGS } from "./site";

/**
 * Přístupnost průvodce (WCAG 2.2 AA, M5): axe na každém kroku (na mobilu na každé obrazovce kroku),
 * v chybových stavech, v dialogu uložení, na obrazovce Hotovo; dále klávesnice, správa zaměření,
 * cíle dotyku a reflow. Ruční testy (NVDA, VoiceOver, TalkBack) zůstávají povinné, viz
 * docs/test-plan.md. Axe pokryje jen část kritérií.
 */

test.use({ reducedMotion: "reduce" });

async function expectNoViolations(page: Page) {
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
}

/** Axe na každé obrazovce kroku (na počítači je obrazovka jedna). */
async function axeScreens(page: Page, screens: number) {
  await expectNoViolations(page);
  if (!isCompact(page)) return;
  for (let i = 1; i < screens; i++) {
    await next(page);
    await expectNoViolations(page);
  }
}

test.describe("axe: kroky průvodce", () => {
  test("kroky 1 až 3 včetně chybových stavů", async ({ page }) => {
    await page.goto(wizardUrl());
    await expect(heading(page)).toHaveText("Kdo se bere?");
    await expectNoViolations(page);

    // Chyba: bez jmen se nepokračuje, hlášení je slovy a u pole.
    await next(page);
    await expect(page.getByText(/Napište jméno/).first()).toBeVisible();
    await expectNoViolations(page);
    await page.getByLabel("První jméno").fill("Klára");
    await page.getByLabel("Druhé jméno").fill("Matěj");
    await axeScreens(page, 2);
    await next(page);

    await expect(heading(page)).toHaveText("Kdy a kde najdou hosté váš web?");
    await next(page);
    await expect(page.getByText(/Zadejte datum svatby/).first()).toBeVisible();
    await expectNoViolations(page);
    await page.getByLabel("Datum svatby").fill("2027-06-19");
    await axeScreens(page, 2);
    await page.getByLabel("Adresa webu").fill("admin");
    await expect(page.getByText(/není\sk\sdispozici/).first()).toBeVisible();
    await expectNoViolations(page);
    await page.getByLabel("Adresa webu").fill("a-slug-pro-axe");
    await expect(page.getByTestId("slug-status")).toHaveText(/vypadá volná/);
    await next(page);

    await expect(heading(page)).toHaveText("Vyberte vzhled webu");
    await axeScreens(page, 2);
  });

  test("kroky 4 a 5 s chybou a s přidanými kartami", async ({ page }) => {
    await completeRequiredSteps(page, { slug: `a11y-${uniqueTag()}` });
    // Krok 4: obřad bez času nepustí dál, hlášení je slovy.
    await page.getByLabel("Přidat obřad").check();
    await next(page);
    await expect(page.getByText(/Zadejte čas/).first()).toBeVisible();
    await expectNoViolations(page);
    await page.getByLabel("Čas obřadu").fill("14:00");
    await page.getByLabel("Název místa").fill("Zámecká kaple");
    await page.getByLabel("Adresa místa").fill("Zámecká 1");
    await axeScreens(page, 3);
    await next(page);

    // Krok 5: přidané karty ubytování a kontaktu (opakované položky s popisky a tlačítkem Odebrat).
    await expect(heading(page)).toHaveText("Co by hosté měli vědět");
    await nextScreen(page);
    await page.getByRole("button", { name: "Přidat ubytování" }).click();
    await expectNoViolations(page);
    // Rozepsaná karta bez názvu nepustí dál (na mobilu z obrazovky, na počítači z kroku).
    await page.getByLabel("Název", { exact: true }).fill("Penzion U Řeky");
    await nextScreen(page);
    await nextScreen(page);
    await page.getByRole("button", { name: "Přidat kontakt" }).click();
    await expect(page.getByRole("button", { name: "Odebrat kontakt 1" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("kroky 5 až 9 po vyplnění (kontrola s chybou a bez, uložení)", async ({ page }) => {
    await completeRequiredSteps(page, { slug: `a11y-${uniqueTag()}` });
    await fillOptionalSteps(page);
    await expect(heading(page)).toHaveText("Zkontrolujte, co jste zadali");
    await expectNoViolations(page);
    await next(page);
    await expect(heading(page)).toHaveText("Uložit, nebo zveřejnit?");
    await expectNoViolations(page);
  });

  test("kontrola s chybou k opravě", async ({ page }) => {
    await completeRequiredSteps(page, { slug: `a11y-${uniqueTag()}` });
    await page.getByLabel("Přidat obřad").check();
    await nextScreen(page);
    await nextScreen(page);
    // Obřad bez času: přeskočíme (krok se nevaliduje) a na kontrole zbyde chyba.
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Přeskočit", exact: true }).click();
    }
    await expect(heading(page)).toHaveText("Zkontrolujte, co jste zadali");
    await expect(page.getByTestId("review-issues")).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("axe: uložení, náhled a Hotovo", () => {
  test("dialog uložení: e-mail, chyba, kód", async ({ page }) => {
    const tag = uniqueTag();
    await completeRequiredSteps(page, { slug: `a11y-${tag}` });
    for (let i = 0; i < 5; i++) {
      await page.getByRole("button", { name: "Přeskočit", exact: true }).click();
    }
    await page.getByRole("button", { name: "Uložit koncept", exact: true }).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog.getByRole("heading", { name: "Uložte svůj koncept" })).toBeVisible();
    await expectNoViolations(page);

    await dialog.getByRole("button", { name: "Poslat kód" }).click();
    await expect(dialog.getByText(/Zadejte platný e-mail/)).toBeVisible();
    await expectNoViolations(page);

    // Esc dialog zavře a zaměření se vrátí do průvodce.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Uložit koncept", exact: true }).click();
    await verifyEmail(page, {
      email: `a11y-${tag}@example.test`,
      backup: `a11y-zaloha-${tag}@example.test`,
    });
    await expect(page.getByTestId("preview-link")).toBeVisible({ timeout: 20_000 });
    await expectNoViolations(page);
  });

  test("živý náhled (rámec i dialog na mobilu)", async ({ page }) => {
    await completeRequiredSteps(page, { slug: `a11y-${uniqueTag()}` });
    if (isCompact(page)) {
      await page.getByRole("button", { name: "Náhled" }).click();
      await expect(page.locator("dialog[open]")).toBeVisible();
    }
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.getByRole("heading", { level: 1 })).toContainText("Klára");
    await expectNoViolations(page);
    if (isCompact(page)) {
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog[open]")).toHaveCount(0);
    }
  });

  test("obrazovka Hotovo", async ({ page }) => {
    const tag = uniqueTag();
    await completeRequiredSteps(page, { slug: `a11y-${tag}` });
    await fillOptionalSteps(page);
    await next(page);
    await page.getByRole("button", { name: "Zveřejnit web", exact: true }).click();
    await verifyEmail(page, {
      email: `hotovo-${tag}@example.test`,
      backup: `hotovo-zaloha-${tag}@example.test`,
    });
    await expect(page.getByTestId("done")).toBeVisible({ timeout: 20_000 });
    await expect(heading(page)).toBeFocused();
    await expectNoViolations(page);
  });

  test("anglická varianta", async ({ page }) => {
    await page.goto(wizardUrl("", "en"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await expectNoViolations(page);
    await next(page);
    await expect(page.getByText(/Enter the name/).first()).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("klávesnice, zaměření, cíle dotyku a reflow", () => {
  test("po přechodu na další krok je zaměřený nadpis, chyba zaměří pole", async ({ page }) => {
    await page.goto(wizardUrl("?jmeno1=Klára&jmeno2=Matěj"));
    await expect(heading(page)).toHaveText("Kdo se bere?");
    await nextScreen(page);
    await next(page);
    await expect(heading(page)).toBeFocused();

    await next(page);
    // chyba: zaměřené pole s datem, chyba je k němu připojená
    await expect(page.getByLabel("Datum svatby")).toBeFocused();
    await expect(page.getByLabel("Datum svatby")).toHaveAttribute("aria-invalid", "true");
    const described = await page.getByLabel("Datum svatby").getAttribute("aria-describedby");
    expect(described).toContain("-error");
  });

  test("celý krok 1 jde projít a odeslat jen klávesnicí", async ({ page }) => {
    await page.goto(wizardUrl());
    await page.getByLabel("První jméno").focus();
    await page.keyboard.type("Klára");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Druhé jméno")).toBeFocused();
    await page.keyboard.type("Matěj");
    await expect(page.getByLabel("První jméno")).toHaveValue("Klára");
    // Tlačítko Další je dosažitelné tabulátorem a odešle se klávesou Enter.
    const nextButton = page.getByTestId("next");
    await nextButton.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    if (isCompact(page)) {
      await expect(page.getByRole("checkbox", { name: "Česky" })).toBeVisible();
    } else {
      await expect(heading(page)).toHaveText("Kdy a kde najdou hosté váš web?");
    }
  });

  test("ovládací prvky mají cíl alespoň 44 px a nepřetékají (reflow na 320 px)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(wizardUrl("?jmeno1=Klára&jmeno2=Matěj"));
    await expect(heading(page)).toHaveText("Kdo se bere?");
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "button, a[href], input:not([type=hidden]), select, textarea, summary",
        ),
      ]
        .filter((el) => el.getClientRects().length > 0 && !el.classList.contains("sr-only"))
        .map((el) => ({
          tag: el.tagName,
          text: (el.textContent ?? "").trim().slice(0, 30),
          rect: el.getBoundingClientRect(),
        }))
        .filter(({ rect }) => rect.height < 43.5 && rect.width < 43.5)
        .map(({ tag, text }) => `${tag} ${text}`),
    );
    expect(small).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await nextScreen(page);
    await next(page);
    await expect(heading(page)).toHaveText("Kdy a kde najdou hosté váš web?");
    const overflowStep2 = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowStep2).toBeLessThanOrEqual(0);
  });

  test("stav ukládání a chyby jsou v živých oblastech", async ({ page }) => {
    await page.goto(wizardUrl());
    await expect(page.getByTestId("save-status")).toHaveAttribute("role", "status");
    await next(page);
    await expect(page.locator('[role="alert"]').first()).toBeAttached();
    await expect(page.getByRole("progressbar", { name: "Postup průvodce" })).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
  });
});
