import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { choose, identify, openRsvp, rsvpSection, send, tenant } from "./rsvp";
import { TAGS, VIEWPORTS } from "./site";
import { GUEST_PIN, type RsvpSetup } from "./support/rsvp-db";
import { tenantUrl } from "./support/admin";
import { withDb } from "./support/db";
import { seedSite } from "./support/guests";
import { expect, test } from "./support/rsvp-fixtures";

/**
 * Přístupnost formulářů RSVP a PINu hostů (WCAG 2.2 AA): axe ve všech stavech formuláře, česky
 * i anglicky, v mobilním (375 px) i stolním zobrazení, velikost cílů, zvětšení na 400 % a klávesnice.
 * Axe pokryje jen část kritérií, ruční testy zůstávají povinné (docs/test-plan.md).
 */

const OBRAD = "Svatební obřad";
const HOSTINA = "Svatební hostina";

const ALL: RsvpSetup = {
  questions: {
    plus_one: true,
    children: true,
    diet: true,
    lodging: true,
    transport: true,
    song: true,
  },
  emailConfirmation: true,
  allowUnlisted: true,
  guestPin: GUEST_PIN,
  custom: [
    {
      key: "menu",
      type: "choice",
      label: { cs: "Menu k hostině", en: "Menu" },
      options: [
        { value: "maso", label: { cs: "Maso", en: "Meat" } },
        { value: "ryba", label: { cs: "Ryba", en: "Fish" } },
      ],
      required: true,
    },
    {
      key: "prekvapeni",
      type: "bool",
      label: { cs: "Pomůžete s překvapením?", en: "Will you help?" },
    },
    { key: "tanec", type: "text", label: { cs: "Váš oblíbený tanec", en: "Your favourite dance" } },
  ],
};

async function violations(page: Page) {
  // Počkat na titulek: po překreslení stránky (např. po akci serveru) může být na okamžik prázdný a axe by hlásil document-title.
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target),
  }));
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
  for (const lang of ["cs", "en"] as const) {
    const t = lang === "cs";
    const events = t ? [OBRAD, HOSTINA] : ["Wedding ceremony", "Wedding dinner"];

    test.describe(`axe: RSVP, ${viewportName}, ${lang}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport);
      });

      test("první krok, neshoda a prázdné jméno", async ({ page, wedding }) => {
        const w = await wedding(ALL);
        await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
        await openRsvp(page, lang);
        expect(await violations(page)).toEqual([]);

        await identify(page, "Nikdo Takový", lang);
        await expect(
          rsvpSection(page).getByRole("alert").filter({ hasText: /./ }).first(),
        ).toBeVisible();
        expect(await violations(page)).toEqual([]);
      });

      test("formulář domácnosti se všemi otázkami, doprovodem a dítětem", async ({
        page,
        wedding,
      }) => {
        const w = await wedding(ALL);
        await w.addHousehold("Novákovi", [
          { name: "Jan Novák" },
          { name: "Anežka Nováková", child: true, age: 9 },
        ]);
        const section = await openRsvp(page, lang);
        await identify(page, "Jan Novák", lang);
        await section.getByRole("checkbox", { name: t ? /doprovod/ : /plus one/ }).check();
        await section.getByRole("button", { name: t ? "Přidat dítě" : "Add a child" }).click();
        expect(await violations(page)).toEqual([]);

        // chybový stav: souhrn chyb s odkazy a chyby u polí
        await send(page, lang);
        await expect(section.locator(".site-error-summary")).toBeFocused();
        expect(await violations(page)).toEqual([]);
      });

      test("potvrzení po odeslání a úprava", async ({ page, wedding }) => {
        const w = await wedding(ALL);
        await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
        const section = await openRsvp(page, lang);
        await identify(page, "Jan Novák", lang);
        await choose(section, "Jan Novák", events[0], "yes", lang);
        await choose(section, "Jan Novák", events[1], "no", lang);
        await section.getByRole("radio", { name: t ? "Ryba" : "Fish" }).check();
        await send(page, lang);
        await expect(section.getByRole("status")).not.toBeEmpty();
        expect(await violations(page)).toEqual([]);
      });

      test("host mimo seznam: formulář i potvrzení", async ({ page, wedding }) => {
        const w = await wedding(ALL);
        await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
        const section = await openRsvp(page, lang);
        await section
          .getByRole("button", {
            name: t ? "Odpovědět jako host mimo seznam" : "Reply as a guest not on the list",
          })
          .click();
        // formulář nahradí první krok až po odpovědi serveru; psát do něj dřív by se ztratilo
        await expect(
          section.getByText(t ? /Novomanželé\spovolili/ : /The couple allows/),
        ).toBeVisible();
        await section.getByLabel(t ? "Vaše jméno" : "Your name").fill("Karel Cizí");
        await section
          .getByRole("button", { name: t ? "Přidat další osobu" : "Add another person" })
          .click();
        expect(await violations(page)).toEqual([]);
        await choose(section, "Karel Cizí", events[0], "yes", lang);
        await choose(section, "Karel Cizí", events[1], "yes", lang);
        await section.getByLabel(t ? "Jméno osoby" : "Person’s name").fill("Karolína Cizí");
        await choose(section, "Karolína Cizí", events[0], "no", lang);
        await choose(section, "Karolína Cizí", events[1], "no", lang);
        await section.getByRole("radio", { name: t ? "Maso" : "Meat" }).check();
        await send(page, lang);
        await expect(section.getByRole("status")).not.toBeEmpty();
        expect(await violations(page)).toEqual([]);
      });
    });
  }
}

test.describe("axe: PIN hostů a stavy RSVP", () => {
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    test(`chyba PINu a odemčený obsah, ${viewportName}`, async ({ page, wedding }) => {
      await page.setViewportSize(viewport);
      await wedding({ guestPin: GUEST_PIN });
      await page.goto(tenant("/"));
      const gifts = page.locator("#dary");
      await gifts.getByLabel("PIN z pozvánky").fill("135790");
      await gifts.getByRole("button", { name: "Odemknout" }).click();
      await expect(gifts.getByText(/PIN nesouhlasí/)).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await gifts.getByLabel("PIN z pozvánky").fill(GUEST_PIN);
      await gifts.getByRole("button", { name: "Odemknout" }).click();
      await expect(gifts.getByText("2501234567/2010")).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`zavřené a ještě neotevřené potvrzování, ${viewportName}`, async ({ page, wedding }) => {
      await page.setViewportSize(viewport);
      await wedding({ closesAt: new Date(Date.now() - 3_600_000).toISOString() });
      await openRsvp(page);
      await expect(rsvpSection(page).getByText("Potvrzení účasti je již uzavřeno.")).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await wedding({ opensAt: new Date(Date.now() + 86_400_000).toISOString() });
      await openRsvp(page);
      await expect(
        rsvpSection(page).getByText("Potvrzení účasti se otevře později."),
      ).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});

test.describe("velikost cílů, zvětšení a klávesnice (WCAG 2.5.8, 1.4.10, 2.1.1)", () => {
  test("ovládací prvky formuláře mají cíl aspoň 44 px", async ({ page, wedding }) => {
    await page.setViewportSize(VIEWPORTS.mobil);
    const w = await wedding(ALL);
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }, { name: "Marie Nováková" }]);
    const section = await openRsvp(page);
    const small = async () =>
      section.evaluate((root) => {
        const bad: string[] = [];
        const selector =
          "button, .site-choice, input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([tabindex='-1'])";
        for (const el of root.querySelectorAll<HTMLElement>(selector)) {
          const box = el.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) continue;
          if (box.height < 43.5 || box.width < 43.5) {
            bad.push(
              `${el.tagName} ${el.textContent?.trim().slice(0, 30)} ${Math.round(box.width)}x${Math.round(box.height)}`,
            );
          }
        }
        return bad;
      });
    expect(await small()).toEqual([]);

    await identify(page, "Jan Novák");
    await section.getByRole("checkbox", { name: /doprovod/ }).check();
    await section.getByRole("button", { name: "Přidat dítě" }).click();
    expect(await small()).toEqual([]);
  });

  test("při zvětšení na 400 % (320 px) formulář nevytéká do strany", async ({ page, wedding }) => {
    await page.setViewportSize({ width: 320, height: 256 });
    const w = await wedding(ALL);
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }, { name: "Marie Nováková" }]);
    const section = await openRsvp(page);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await identify(page, "Jan Novák");
    await section.getByRole("checkbox", { name: /doprovod/ }).check();
    await section
      .getByLabel("Jméno doprovodu")
      .fill("Tereza Doprovodová s velmi dlouhým příjmením");
    await section.getByRole("button", { name: "Přidat dítě" }).click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await send(page);
    await expect(section.locator(".site-error-summary")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    // písmo 200 %
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("celý první krok i formulář ovládá klávesnice a po chybě se vrací do pole", async ({
    page,
    wedding,
  }) => {
    const w = await wedding(ALL);
    await w.addHousehold("Novákovi", [{ name: "Jan Novák" }]);
    const section = await openRsvp(page);
    const field = section.getByLabel("Vaše jméno");
    await field.focus();
    await page.keyboard.type("Nikdo Takový");
    await page.keyboard.press("Enter");
    await expect(section.getByText(/Nenašli jsme vás/)).toBeVisible();
    await expect(field).toBeFocused();

    await field.fill("Jan Novák");
    await page.keyboard.press("Enter");
    await expect(section.getByRole("heading", { name: "Jan Novák" })).toBeVisible();
    // radio skupiny se ovládají šipkami a mezerníkem
    const group = section.getByRole("group", { name: `Jan Novák: ${OBRAD}` });
    await group.getByRole("radio", { name: "Přijde", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(group.getByRole("radio", { name: "Přijde", exact: true })).toBeChecked();
    await page.keyboard.press("ArrowRight");
    await expect(group.getByRole("radio", { name: "Nepřijde", exact: true })).toBeChecked();
  });
});

test.describe("axe: zamčený web", () => {
  test("brána s PINem (i s chybou) a reflow na 320 px", async ({ page }) => {
    // vlastní web: zámek sdílené svatby by viděly souběžné testy webu bez zámku
    const site = await seedSite({ guestPin: GUEST_PIN });
    await withDb((db) =>
      db.query("update se_vezmou.weddings set site_locked = true where id = $1", [site.weddingId]),
    );
    await page.goto(tenantUrl(site.slug));
    await expect(
      page.getByRole("heading", { level: 2, name: "Web je jen pro pozvané hosty" }),
    ).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.getByLabel("PIN z pozvánky").fill("12");
    await page.getByRole("button", { name: "Odemknout" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("PIN");
    expect(await violations(page)).toEqual([]);
    await page.setViewportSize({ width: 320, height: 256 });
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
