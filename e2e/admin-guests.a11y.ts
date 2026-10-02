import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { toXlsx } from "../src/lib/export/xlsx";
import { appUrl, GUEST_PIN } from "./support/admin";
import { expect, test } from "./support/fixtures";
import { seedHouseholds, seedSite } from "./support/guests";
import { admin, loginAsOperator, seedOperator } from "./support/ops";
import { withDb } from "./support/db";

/**
 * Přístupnost správy hostů, odpovědí a přístupu (WCAG 2.2 AA, M7b): axe na každé nové obrazovce
 * včetně stavů s chybami, náhledu importu, potvrzovacích kroků a angličtiny, ovládání klávesnicí,
 * viditelný focus, cíle dotyku 44 px, reflow 320 px a stav hlášený čtečkám. Běží na počítači i v
 * mobilním viewportu (projekty a11y a a11y-mobile). Ruční testy se čtečkami (MAN-08) zůstávají
 * povinné, viz docs/test-plan.md.
 */

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

async function seedWithGuests() {
  const site = await seedSite({ guestPin: GUEST_PIN });
  const [household] = await seedHouseholds(site.weddingId, [
    {
      label: "Novákovi",
      guests: [
        { name: "Jan Novák" },
        { name: "Eva Nováková" },
        { name: "Tomáš", child: true, age: 6 },
      ],
    },
    { label: "Černí", guests: [{ name: "Karel Černý" }], events: ["ceremony"] },
  ]);
  return { site, household };
}

test.describe("axe: hosté", () => {
  test("seznam hostů (prázdný, s daty, s filtrem), česky i anglicky", async ({ page, context }) => {
    const site = await seedSite();
    await site.login(context);
    await page.goto(appUrl("/hoste"));
    await expect(page.getByRole("heading", { level: 1, name: "Hosté" })).toBeVisible();
    await expectNoViolations(page);

    await seedHouseholds(site.weddingId, [
      {
        label: "Novákovi",
        guests: [{ name: "Jan Novák" }, { name: "Tomáš", child: true, age: 6 }],
      },
    ]);
    await page.goto(appUrl("/hoste?ulozeno=1"));
    await expect(page.getByText("Uloženo.", { exact: true })).toBeVisible();
    await expectNoViolations(page);
    await page.getByLabel("Hledat hosta nebo domácnost").fill("neexistuje");
    await expect(page.getByText("Zobrazeno domácností: 0")).toBeVisible();
    await expectNoViolations(page);

    await page.goto(appUrl("/en/hoste"));
    await expect(page.getByRole("heading", { level: 1, name: "Guests" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("úprava domácnosti: nová s chybami, existující s dítětem, angličtina", async ({
    page,
    context,
  }) => {
    const { site, household } = await seedWithGuests();
    await site.login(context);
    await page.goto(appUrl("/hoste/domacnost/nova"));
    await expect(page.getByRole("heading", { level: 1, name: "Nová domácnost" })).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Uložit domácnost" }).click();
    await expect(page.getByText("Vyplňte jméno hosta.")).toBeVisible();
    await expectNoViolations(page);

    await page.goto(appUrl(`/hoste/domacnost/${household}`));
    await expect(page.getByRole("heading", { level: 1, name: "Úprava domácnosti" })).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Smazat domácnost" }).click();
    await expect(page.getByText(/Smazat celou domácnost včetně hostů/)).toBeVisible();
    await expectNoViolations(page);

    await page.goto(appUrl(`/en/hoste/domacnost/${household}`));
    await expect(page.getByRole("heading", { level: 1, name: "Edit household" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("import: výběr souboru, náhled s chybami a duplicitami, hotovo", async ({
    page,
    context,
  }) => {
    const { site } = await seedWithGuests();
    await site.login(context);
    await page.goto(appUrl("/hoste/import"));
    await expect(page.getByRole("heading", { level: 1, name: "Import hostů" })).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Zobrazit náhled" }).click();
    await expect(page.getByText("Vyberte soubor, který chcete nahrát.")).toBeVisible();
    await expectNoViolations(page);

    const xlsx = await toXlsx({
      name: "Hosté",
      headers: ["Domácnost", "Jméno a příjmení", "Dítě", "Věk"],
      rows: [
        ["Svobodovi", "Marie Svobodová", "ne", null],
        ["Svobodovi", "Tomáš Svoboda", "ano", 6],
        [null, "Jan Novák", "ne", null],
        [null, "Petr", "možná", null],
      ],
    });
    await page.getByLabel("Soubor se seznamem hostů").setInputFiles({
      name: "hoste.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx,
    });
    await page.getByRole("button", { name: "Zobrazit náhled" }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: "2. Zkontrolujte náhled" }),
    ).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Importovat hostů: 2" }).click();
    await expect(page.getByTestId("import-result")).toBeVisible();
    await expectNoViolations(page);

    await page.goto(appUrl("/en/hoste/import"));
    await expect(page.getByRole("heading", { level: 1, name: "Import guests" })).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("axe: odpovědi", () => {
  test("přehled odpovědí s daty a ruční zápis s chybami, doprovodem a otázkami", async ({
    page,
    context,
  }) => {
    const { site, household } = await seedWithGuests();
    await site.login(context);
    await withDb(async (db) => {
      await db.query(
        "update se_vezmou.rsvp_settings set enabled_questions = $2 where wedding_id = $1",
        [
          site.weddingId,
          JSON.stringify({ plus_one: true, children: true, diet: true, lodging: true, song: true }),
        ],
      );
      await db.query(
        `insert into se_vezmou.rsvp_questions (wedding_id, key, type, label, options, required, position)
         values ($1, 'menu', 'choice', '{"cs": "Jaké menu?"}', '[{"value": "maso", "label": {"cs": "Maso"}}, {"value": "ryba", "label": {"cs": "Ryba"}}]', true, 1)`,
        [site.weddingId],
      );
    });
    await page.goto(appUrl("/odpovedi"));
    await expect(page.getByRole("heading", { level: 1, name: "Odpovědi" })).toBeVisible();
    await expectNoViolations(page);

    await page.goto(appUrl(`/odpovedi/${household}`));
    await expect(page.getByRole("heading", { level: 1, name: "Zápis odpovědi" })).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Přidat dítě" }).click();
    await page.getByRole("button", { name: "Uložit odpověď" }).click();
    await expect(page.getByText("Opravte prosím označená pole.")).toBeVisible();
    await expectNoViolations(page);

    await page.goto(appUrl("/en/odpovedi"));
    await expect(page.getByRole("heading", { level: 1, name: "Replies" })).toBeVisible();
    await expectNoViolations(page);
    await page.goto(appUrl(`/en/odpovedi/${household}`));
    await expect(page.getByRole("heading", { level: 1, name: "Enter a reply" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("nastavení odpovědí: s vlastními otázkami a chybami, angličtina", async ({
    page,
    context,
  }) => {
    const site = await seedSite();
    await site.login(context);
    await page.goto(appUrl("/odpovedi/nastaveni"));
    await expect(page.getByRole("heading", { level: 1, name: "Nastavení odpovědí" })).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Přidat otázku" }).click();
    await page.getByLabel("Druh odpovědi").selectOption("choice");
    await page.getByRole("group", { name: "Uzavřít po" }).getByLabel("Datum").fill("2027-06-01");
    await page.getByRole("button", { name: "Uložit nastavení" }).click();
    await expect(page.getByText("Vyplňte datum i čas, nebo obojí nechte prázdné.")).toBeVisible();
    await expect(page.getByText("Vyplňte text otázky aspoň v jednom jazyce.")).toBeVisible();
    await expectNoViolations(page);

    await page.goto(appUrl("/en/odpovedi/nastaveni"));
    await expect(page.getByRole("heading", { level: 1, name: "Reply settings" })).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("axe: přístup a data", () => {
  test("přístup: správci, potvrzovací kroky, souhlas s nahlédnutím a jeho evidence", async ({
    page,
    context,
  }) => {
    const { site } = await seedWithGuests();
    await site.login(context);
    await page.goto(appUrl("/pristup"));
    await expect(page.getByRole("heading", { level: 1, name: "Přístup" })).toBeVisible();
    await expectNoViolations(page);

    await page.getByLabel("E-mail nového správce").fill("druhy@example.test");
    await page.getByRole("button", { name: "Přidat správce", exact: true }).click();
    await expect(page.getByRole("button", { name: "Ano, přidat" })).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Zrušit" }).click();

    await page.getByLabel("E-mail nového správce").fill("bez-zavinace");
    await page.getByRole("button", { name: "Přidat správce", exact: true }).click();
    await expect(page.getByText("Zadejte platný e-mail, například eva@example.cz.")).toBeVisible();
    await expectNoViolations(page);

    await page.getByRole("button", { name: "Udělit souhlas" }).click();
    await expect(page.getByText("Napište stručně důvod, aspoň pár slov.")).toBeVisible();
    await expectNoViolations(page);
    await page.getByLabel("Důvod", { exact: true }).fill("Nejde mi import seznamu");
    await page.getByRole("button", { name: "Udělit souhlas" }).click();
    await page.getByRole("button", { name: "Ano, povolit" }).click();
    await expect(page.getByTestId("consent-state")).toContainText("Souhlas platí do");
    await expectNoViolations(page);

    // záznam o nahlédnutí provozovatele
    const operator = await seedOperator({ role: "support", enrolled: true });
    await loginAsOperator(page, operator);
    await page.goto(admin(`/zakazky/${site.weddingId}`));
    const guests = page.getByRole("region", { name: "Údaje hostů" });
    await guests.getByLabel("Důvod nahlédnutí").fill("Řešení potíží s importem");
    await guests.getByRole("button", { name: "Zobrazit údaje hostů" }).click();
    await expect(guests.getByRole("rowheader", { name: "Jan Novák" })).toBeVisible();
    await page.goto(appUrl("/pristup"));
    await expect(page.getByTestId("operator-views")).toBeVisible();
    await expectNoViolations(page);

    await page.goto(appUrl("/en/pristup"));
    await expect(page.getByRole("heading", { level: 1, name: "Access" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("data a smazání: s chybou potvrzení, angličtina", async ({ page, context }) => {
    const site = await seedSite();
    await site.login(context);
    await page.goto(appUrl("/data"));
    await expect(page.getByRole("heading", { level: 1, name: "Data a smazání" })).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Smazat web", exact: true }).click();
    await expect(page.getByText("Napište přesně slovo, které je uvedeno nad polem.")).toBeVisible();
    await expectNoViolations(page);
    await page.goto(appUrl("/en/data"));
    await expect(page.getByRole("heading", { level: 1, name: "Data and deletion" })).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("ovládání a zobrazení", () => {
  test("domácnost jde upravit jen klávesnicí a stav se hlásí čtečce", async ({ page, context }) => {
    const site = await seedSite();
    await site.login(context);
    await page.goto(appUrl("/hoste/domacnost/nova"));
    await expect(page.getByRole("heading", { level: 1, name: "Nová domácnost" })).toBeVisible();

    await page.getByLabel("Název domácnosti").focus();
    await page.keyboard.type("Svobodovi");
    await page.getByLabel("Jméno a příjmení").focus();
    await page.keyboard.type("Petr Svoboda");
    await page.getByRole("button", { name: "Přidat dalšího hosta" }).focus();
    await page.keyboard.press("Enter");
    // nově přidané pole dostane zaměření
    await expect(
      page.getByRole("article", { name: "Host 2" }).getByLabel("Jméno a příjmení"),
    ).toBeFocused();
    await page.keyboard.type("Eva Svobodová");
    await page.getByRole("button", { name: "Uložit domácnost" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: "Svobodovi" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Uloženo." })).toHaveCount(1);
  });

  test("viditelný focus a cíle dotyku nejméně 44 px na nových obrazovkách", async ({
    page,
    context,
  }) => {
    const { site, household } = await seedWithGuests();
    await site.login(context);
    for (const path of [
      "/hoste",
      `/hoste/domacnost/${household}`,
      "/hoste/import",
      "/odpovedi",
      `/odpovedi/${household}`,
      "/odpovedi/nastaveni",
      "/pristup",
      "/data",
    ]) {
      await page.goto(appUrl(path));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        const outline = await page.evaluate(() => {
          const style = getComputedStyle(document.activeElement as HTMLElement);
          return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
        });
        expect(outline.style, path).not.toBe("none");
        expect(outline.width, path).toBeGreaterThanOrEqual(2);
      }
      const small = await page
        .locator(
          "main button:visible, main a:visible, main input:not([type=hidden]):visible, main select:visible",
        )
        .evaluateAll((els) =>
          els
            .map((el) => {
              const r = el.getBoundingClientRect();
              const label = el.closest("label");
              const box = label ? label.getBoundingClientRect() : r;
              return {
                text:
                  el.textContent?.trim() ||
                  el.getAttribute("aria-label") ||
                  el.getAttribute("name"),
                height: Math.max(r.height, box.height),
                width: Math.max(r.width, box.width),
              };
            })
            .filter((item) => item.height < 44 || item.width < 44),
        );
      expect(small, path).toEqual([]);
    }
  });

  test("šířka 320 px: žádné vodorovné posouvání stránky (WCAG 1.4.10)", async ({
    page,
    context,
  }) => {
    const { site, household } = await seedWithGuests();
    await site.login(context);
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of [
      "/hoste",
      `/hoste/domacnost/${household}`,
      "/hoste/import",
      "/odpovedi",
      `/odpovedi/${household}`,
      "/odpovedi/nastaveni",
      "/pristup",
      "/data",
    ]) {
      await page.goto(appUrl(path));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("stránky mají vlastní titulek", async ({ page, context }) => {
    const site = await seedSite();
    await site.login(context);
    const titles: Record<string, string> = {
      "/hoste": "Hosté | Se vezmou",
      "/hoste/import": "Import hostů | Se vezmou",
      "/odpovedi": "Odpovědi | Se vezmou",
      "/odpovedi/nastaveni": "Nastavení odpovědí | Se vezmou",
      "/pristup": "Přístup | Se vezmou",
      "/data": "Data a smazání | Se vezmou",
    };
    for (const [path, title] of Object.entries(titles)) {
      await page.goto(appUrl(path));
      await expect(page).toHaveTitle(title);
    }
  });
});
