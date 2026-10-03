import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { uniqueTag, withDb } from "./support/db";
import { expect, test } from "./support/fixtures";
import {
  admin,
  freshTotp,
  grantGuestAccess,
  loginAsOperator,
  passFirstFactor,
  requestOperatorCode,
  seedOperator,
  seedOpsWedding,
} from "./support/ops";
import { totpAt } from "../src/ops/totp";
import { localeNames } from "../src/i18n/config";

/**
 * Přístupnost provozní administrace (WCAG 2.2 AA, M9): axe na každé obrazovce včetně chybových stavů,
 * zásahů a výsledků, na počítači i na mobilu (stejné testy běží v projektech a11y a a11y-mobile),
 * ovládání klávesnicí, cíle dotyku 44 px a reflow bez vodorovného posunu stránky. Před axe se vždy čeká na
 * titulek stránky (po překreslení po akci serveru může být na okamžik prázdný). Ruční testy (NVDA,
 * správce hesel, MAN-08) zůstávají povinné, viz docs/test-plan.md.
 */

// Plynulé posouvání by klikání na prvky mimo obraz zdržovalo (prvek není stabilní); jde o chování, ne o vzhled.
test.use({ reducedMotion: "reduce" });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page) {
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

const card = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test.describe("axe: angličtina (předpona /en a přepínač jazyka)", () => {
  test("přihlášení, přehled a seznam zakázek anglicky", async ({ page }) => {
    await page.goto(admin("/en/prihlaseni"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await expect(page.getByRole("navigation", { name: "Language", exact: true })).toBeVisible();
    await expectNoViolations(page);

    const owner = await seedOperator({ role: "owner", enrolled: true });
    await loginAsOperator(page, owner);
    for (const path of ["/en", "/en/zakazky", "/en/ucet"]) {
      await page.goto(admin(path));
      await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
      await expect(page.getByRole("navigation", { name: "Language", exact: true })).toBeVisible();
      await expectNoViolations(page);
    }
  });
});

test.describe("axe: přihlášení operátora", () => {
  test("e-mail, i s chybou", async ({ page }) => {
    await page.goto(admin("/prihlaseni"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoViolations(page);
    await page.getByLabel("E-mail").fill("klara");
    await page.getByRole("button", { name: "Poslat kód" }).click();
    await expect(page.getByText(/Zadejte platný e-mail/)).toBeVisible();
    await expectNoViolations(page);
  });

  test("kód z e-mailu, i s chybou", async ({ page }) => {
    const operator = await seedOperator({ enrolled: true });
    await requestOperatorCode(page, operator.email);
    await expectNoViolations(page);
    await page.getByLabel("Šestimístný kód").fill("12");
    await page.getByRole("button", { name: "Pokračovat" }).click();
    await expect(page.getByLabel("Šestimístný kód")).toHaveAttribute("aria-invalid", "true");
    await expectNoViolations(page);
  });

  test("druhý faktor, i s chybou", async ({ page }) => {
    const operator = await seedOperator({ enrolled: true });
    await passFirstFactor(page, operator);
    await expectNoViolations(page);
    await page.getByLabel("Kód z aplikace nebo záložní kód").fill("000000");
    await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
    await expect(page.getByText(/Kód nesouhlasí nebo už byl použit/)).toBeVisible();
    await expectNoViolations(page);
  });

  test("zápis druhého faktoru: klíč, chyba i záložní kódy", async ({ page }) => {
    const operator = await seedOperator({ enrolled: false });
    await passFirstFactor(page, operator);
    await expect(page.getByRole("img", { name: /QR kód/ })).toBeVisible();
    await expectNoViolations(page);
    await page.getByLabel("Šestimístný kód z aplikace").fill("000000");
    await page.getByRole("button", { name: "Potvrdit a vytvořit záložní kódy" }).click();
    await expect(page.getByText(/Kód nesouhlasí/)).toBeVisible();
    await expectNoViolations(page);

    const secret = (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{4}){7}$/).innerText()).replace(
      / /g,
      "",
    );
    await page.getByLabel("Šestimístný kód z aplikace").fill(totpAt(secret, Date.now()));
    await page.getByRole("button", { name: "Potvrdit a vytvořit záložní kódy" }).click();
    await expect(page.getByRole("heading", { name: "Uložte si záložní kódy" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("přihlášení jde celé klávesnicí a pole nebrání vkládání", async ({ page }) => {
    const operator = await seedOperator({ enrolled: true });
    await page.goto(admin("/prihlaseni"));
    await page.keyboard.press("Tab"); // odkaz Přeskočit na obsah
    await expect(page.getByRole("link", { name: "Přeskočit na obsah" })).toBeFocused();
    // Přepínač jazyka v hlavičce: jeden odkaz na každý jazyk, pak formulář.
    const switcher = page.getByRole("navigation", { name: "Jazyk", exact: true });
    for (const name of Object.values(localeNames)) {
      await page.keyboard.press("Tab");
      await expect(switcher.getByRole("link", { name })).toBeFocused();
    }
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("E-mail")).toBeFocused();
    await page.keyboard.type(operator.email);
    await page.keyboard.press("Enter");
    await page.waitForURL(admin("/prihlaseni/kod"));
    await expect(page.getByLabel("Šestimístný kód")).toBeVisible();
  });
});

test.describe("axe: přehled a seznam zakázek", () => {
  test("přehled, seznam (s výsledky i prázdný), retence a účet", async ({ page }) => {
    const operator = await seedOperator({ role: "support", enrolled: true });
    const base = uniqueTag();
    const w = await seedOpsWedding({ tag: base, status: "deleted" });
    await withDb((db) =>
      db.query(
        "insert into se_vezmou.analytics_event (event, locale, step) values ('wizard_step_completed', 'cs', 2)",
      ),
    );
    await loginAsOperator(page, operator);
    await expectNoViolations(page); // přehled

    await page.goto(admin(`/zakazky?q=${base}`));
    await expect(page.getByRole("link", { name: w.names })).toBeVisible();
    await expectNoViolations(page);

    await page.goto(admin(`/zakazky?q=neexistujici${base}`));
    await expect(page.getByText("Žádná zakázka neodpovídá filtrům.")).toBeVisible();
    await expectNoViolations(page);

    await page.goto(admin("/retence"));
    await expect(page.getByRole("link", { name: w.names })).toBeVisible();
    await expectNoViolations(page);

    await page.goto(admin("/ucet"));
    await page.getByLabel("Kód z aplikace pro ověřování").fill(await freshTotp(operator));
    await page.getByRole("button", { name: "Vytvořit nové kódy" }).click();
    await expect(page.getByRole("heading", { name: "Nové záložní kódy" })).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("axe: detail zakázky a zásahy", () => {
  test("detail majitele se všemi zásahy, chybami a výsledkem", async ({ page }) => {
    const operator = await seedOperator({ role: "owner", enrolled: true });
    const w = await seedOpsWedding({ guests: [`Host ${uniqueTag()}`] });
    await grantGuestAccess(w);
    await withDb((db) =>
      db.query(
        "insert into se_vezmou.operator_notes (wedding_id, operator_id, body) values ($1, $2, 'Poznámka k zakázce')",
        [w.weddingId, operator.id],
      ),
    );
    await loginAsOperator(page, operator);
    await page.goto(admin(`/zakazky/${w.weddingId}`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(w.partnerA);
    await expectNoViolations(page);

    // chyby formulářů (bez důvodu)
    await card(page, "Změna stavu").getByLabel("Nový stav").selectOption({ label: "Zablokováno" });
    await card(page, "Změna stavu").getByRole("button", { name: "Změnit stav" }).click();
    await expect(card(page, "Změna stavu").getByText("Vyplňte důvod.")).toBeVisible();
    await card(page, "Změna adresy webu").getByLabel("Nová adresa").fill("Špatná adresa");
    await card(page, "Změna adresy webu").getByLabel("Důvod").fill("Zkouška");
    await card(page, "Změna adresy webu").getByRole("button", { name: "Změnit adresu" }).click();
    await expect(card(page, "Změna adresy webu").getByText(/Adresa smí obsahovat/)).toBeVisible();
    await expectNoViolations(page);

    // údaje hostů se souhlasem
    const guests = card(page, "Údaje hostů");
    await guests.getByLabel("Důvod nahlédnutí").fill("Kontrola pro a11y");
    await guests.getByRole("button", { name: "Zobrazit údaje hostů" }).click();
    await expect(guests.getByRole("table")).toBeVisible();
    await expectNoViolations(page);

    // výsledek zásahu
    await card(page, "Nová poznámka").getByLabel("Poznámka").fill("Nová poznámka");
    await card(page, "Nová poznámka").getByRole("button", { name: "Přidat poznámku" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Poznámka byla přidána." }),
    ).toBeVisible();
    await expectNoViolations(page);
  });

  test("detail podpory, smazané zakázky a odmítnutého nahlédnutí", async ({ page }) => {
    const support = await seedOperator({ role: "support", enrolled: true });
    const w = await seedOpsWedding();
    await loginAsOperator(page, support);
    await page.goto(admin(`/zakazky/${w.weddingId}`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(w.partnerA);
    await expectNoViolations(page);

    const guests = card(page, "Údaje hostů");
    await guests.getByLabel("Důvod nahlédnutí").fill("Bez souhlasu");
    await guests.getByRole("button", { name: "Zobrazit údaje hostů" }).click();
    await expect(guests.getByText(/Přístup byl odmítnut/)).toBeVisible();
    await expectNoViolations(page);

    const deleted = await seedOpsWedding({ status: "deleted" });
    await withDb((db) =>
      db.query(
        "update se_vezmou.weddings set purge_at = now() + interval '20 days' where id = $1",
        [deleted.weddingId],
      ),
    );
    const owner = await seedOperator({ role: "owner", enrolled: true });
    await page.getByRole("button", { name: "Odhlásit se" }).click();
    await page.waitForURL(admin("/prihlaseni"));
    await loginAsOperator(page, owner);
    await page.goto(admin(`/zakazky/${deleted.weddingId}`));
    await expect(card(page, "Obnovení smazaného webu")).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("axe: audit a správa operátorů", () => {
  test("audit s filtry a záznamy, operátoři s formuláři", async ({ page }) => {
    const owner = await seedOperator({ role: "owner", enrolled: true });
    await seedOperator({ role: "support", enrolled: true });
    await loginAsOperator(page, owner);

    await page.goto(admin("/audit"));
    await expect(page.getByRole("table", { name: "Záznamy auditu" })).toBeVisible();
    await expectNoViolations(page);
    await page.getByLabel("Zakázka (identifikátor)").fill("neni-uuid");
    await page.getByRole("button", { name: "Použít filtry" }).click();
    await expect(page.getByText("Identifikátor zakázky má tvar UUID.")).toBeVisible();
    await expectNoViolations(page);

    await page.goto(admin("/operatori"));
    await expect(page.getByRole("table", { name: "Seznam operátorů" })).toBeVisible();
    await expectNoViolations(page);
    const create = card(page, "Přidat operátora");
    await create.getByLabel("E-mail operátora").fill("neplatny");
    await create.getByRole("button", { name: "Přidat operátora" }).click();
    await expect(create.getByText("Zadejte platný e-mail.")).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("klávesnice, cíle dotyku a reflow", () => {
  test("ovladatelné prvky mají cíl alespoň 44 px a stránka se nikdy nezobrazí vodorovně posuvná", async ({
    page,
  }) => {
    const owner = await seedOperator({ role: "owner", enrolled: true });
    const w = await seedOpsWedding();
    await loginAsOperator(page, owner);

    for (const path of [
      "/",
      `/zakazky?q=${w.tag}`,
      `/zakazky/${w.weddingId}`,
      "/audit",
      "/operatori",
      "/retence",
      "/ucet",
    ]) {
      await page.goto(admin(path));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const small = await page.evaluate(() => {
        const found: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(
          "a[href], button, select, textarea, input:not([type=hidden]), [tabindex='0']",
        )) {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden") continue;
          // odkaz „Přeskočit na obsah“ je mimo obraz do zaměření
          if (el.textContent?.trim() === "Přeskočit na obsah") continue;
          if (rect.height < 43.5) {
            found.push(
              `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(rect.height)} px`,
            );
          }
        }
        return found;
      });
      expect(small, path).toEqual([]);
    }

    // reflow (WCAG 1.4.10): při šířce 320 px se posouvá jen tabulka v oblasti, ne stránka
    await page.setViewportSize({ width: 320, height: 700 });
    for (const path of [
      "/",
      `/zakazky?q=${w.tag}`,
      `/zakazky/${w.weddingId}`,
      "/audit",
      "/operatori",
    ]) {
      await page.goto(admin(path));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("tabulka s posuvem má zaměření z klávesnice a název", async ({ page }) => {
    const owner = await seedOperator({ role: "owner", enrolled: true });
    const w = await seedOpsWedding();
    await loginAsOperator(page, owner);
    await page.goto(admin(`/zakazky?q=${w.tag}`));
    const region = page.getByRole("region", { name: "Seznam zakázek" });
    await expect(region).toHaveAttribute("tabindex", "0");
    await region.focus();
    await expect(region).toBeFocused();
  });
});
