import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  appUrl,
  block,
  expectSaved,
  GUEST_PIN,
  openBlock,
  openEditor,
  seedManagedSite,
} from "./support/admin";
import { OG_BASE } from "./support/og-server";

/**
 * Přístupnost správy webu (WCAG 2.2 AA, M7a): axe na každé obrazovce (přehled, editor s rozbalenými
 * sekcemi a chybami, historie, nápověda, česky i anglicky), ovládání klávesnicí, viditelný focus,
 * cíle dotyku 44 px, reflow 320 px, stav hlášený čtečkám a karta externí galerie na webu páru.
 * Běží na počítači i v mobilním viewportu (projekty a11y a a11y-mobile). Ruční testy se čtečkami
 * (MAN-08) zůstávají povinné, viz docs/test-plan.md.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page) {
  // Počkat na titulek: po překreslení stránky může být na okamžik prázdný a axe by hlásil document-title.
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

/** Na mobilu je editor a náhled na přepínači; na počítači jsou vedle sebe. */
function isCompact(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024;
}

test.describe("axe: obrazovky správy", () => {
  test("přehled Můj web, česky i anglicky", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await page.goto(appUrl("/"));
    await expect(page.getByRole("heading", { level: 1, name: "Můj web" })).toBeVisible();
    await expectNoViolations(page);
    await page.getByLabel("Čeština").fill("Obřad začíná dřív.");
    await page.getByLabel("Zobrazit pruh na webu").check();
    await page.getByRole("button", { name: "Uložit rychlou změnu" }).click();
    await expect(page.getByText("Pruh je na webu.")).toBeVisible();
    await expectNoViolations(page);
    // chyba slovy
    await page.getByLabel("Čeština").fill("");
    await page.getByLabel("English").fill("");
    await page.getByRole("button", { name: "Uložit rychlou změnu" }).click();
    await expect(page.getByText("Napište text pruhu, nebo pruh vypněte.")).toBeVisible();
    await expectNoViolations(page);

    await page.goto(appUrl("/en"));
    await expect(page.getByRole("heading", { level: 1, name: "My website" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("přehled s výběrem svatby", async ({ page, context }) => {
    const first = await seedManagedSite();
    await seedManagedSite({ names: ["Eva", "Petr"], adminEmail: first.adminEmail });
    await first.login(context);
    await page.goto(appUrl("/"));
    await expect(page.getByRole("heading", { level: 2, name: "Vaše svatby" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("editor: sbalený, s rozbalenými sekcemi a s chybami", async ({ page, context }) => {
    const site = await seedManagedSite({ guestPin: GUEST_PIN });
    await site.login(context);
    await openEditor(page);
    await expectNoViolations(page);

    // všechny sekce rozbalené (zapnout vypnuté a rozbalit)
    for (const [type, name] of [
      ["hero", "Úvod"],
      ["program", "Program"],
      ["venue", "Místo konání"],
      ["lodging", "Ubytování a doprava"],
      ["dresscode", "Dress code"],
      ["faq", "Časté otázky"],
      ["contact", "Kontakt"],
      ["story", "Náš příběh"],
      ["gifts", "Dary"],
      ["gallery", "Fotografie"],
      ["rsvp", "Potvrzení účasti"],
    ] as const) {
      const checkbox = block(page, type).getByRole("checkbox", {
        name: `Zobrazit na webu: ${name}`,
      });
      if ((await checkbox.count()) > 0 && !(await checkbox.isChecked())) await checkbox.check();
      await openBlock(page, type, name);
    }
    // položky seznamů, aby se zkontrolovaly i jejich formuláře
    await block(page, "faq").getByRole("button", { name: "Přidat otázku" }).click();
    await block(page, "contact").getByRole("button", { name: "Přidat kontakt" }).click();
    await block(page, "lodging").getByRole("button", { name: "Přidat ubytování" }).click();
    await block(page, "program").getByRole("button", { name: "Přidat událost" }).click();
    await block(page, "venue").getByRole("button", { name: "Přidat místo" }).click();
    const gallery = block(page, "gallery");
    await gallery.getByLabel("Přidat odkaz na externí fotogalerii").check();
    await gallery.getByLabel("Zobrazit odkaz jen po zadání PINu hostů").check();
    await block(page, "gifts").getByLabel("Číslo účtu").fill("19-2000145399/0800");
    await block(page, "contact").getByLabel("E-mail (nepovinné)").fill("neplatny");
    await expect(block(page, "contact").getByText("Zadejte platný e-mail")).toBeVisible();
    await expectSaved(page);
    await expectNoViolations(page);

    // chybový stav publikace
    await page.getByRole("button", { name: "Zveřejnit změny" }).click();
    await expect(page.getByTestId("publish-result")).toContainText("Web zatím nejde zveřejnit");
    await expectNoViolations(page);
  });

  test("editor: překlady, bod pro vrácení a stažení z publikace", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    await expect(page.getByTestId("translation-gaps")).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Uložit bod pro vrácení" }).click();
    await expect(page.getByTestId("publish-result")).toContainText("Bod pro vrácení je uložený");
    await page.getByRole("button", { name: "Stáhnout z publikace" }).click();
    await expect(page.getByText("Opravdu stáhnout web z publikace?")).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole("button", { name: "Ano, stáhnout" }).click();
    await expect(page.getByTestId("publish-result")).toContainText("Web je stažený z publikace");
    await expectNoViolations(page);
  });

  test("editor: náhled (na mobilu na přepínači)", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    if (isCompact(page)) {
      await page.getByRole("button", { name: "Náhled", exact: true }).click();
      await expect(page.getByRole("button", { name: "Náhled", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    const frame = page.frameLocator('iframe[data-testid="site-preview-frame"]');
    await expect(frame.getByRole("heading", { level: 1 })).toContainText("Klára");
    await expect(page.locator('iframe[data-testid="site-preview-frame"]')).toHaveAttribute(
      "title",
      /náhled/i,
    );
    await expectNoViolations(page);
  });

  test("editor, angličtina", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page, "/en/web");
    await expectNoViolations(page);
    await expect(page.getByRole("heading", { level: 1, name: "Edit website" })).toBeVisible();
  });

  test("historie verzí a nápověda", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await page.goto(appUrl("/web/historie"));
    await expect(page.getByRole("heading", { level: 1, name: "Historie verzí" })).toBeVisible();
    await expectNoViolations(page);
    await page.getByTestId("help-box").getByText("Nápověda k této obrazovce").click();
    await expect(
      page.getByTestId("help-box").getByRole("link", { name: "Všechna témata nápovědy" }),
    ).toBeVisible();
    await expectNoViolations(page);
    await page.goto(appUrl("/napoveda"));
    await expectNoViolations(page);
    await page.goto(appUrl("/en/web/historie"));
    await expectNoViolations(page);
    await page.goto(appUrl("/en/napoveda"));
    await expectNoViolations(page);
  });
});

test.describe("axe: karta externí galerie na webu páru", () => {
  test("veřejná karta, česky i anglicky", async ({ page }) => {
    const site = await seedManagedSite({
      guestPin: GUEST_PIN,
      tweak: (blocks) =>
        blocks.map((b) =>
          b.type === "gallery"
            ? {
                ...b,
                enabled: true,
                data: {
                  mediaIds: [],
                  photosProtected: false,
                  link: {
                    url: `${OG_BASE}/galerie?t=${Math.random().toString(36).slice(2)}`,
                    label: { cs: "Fotky od Anny", en: "Photos by Anna" },
                    protected: false,
                    card: {
                      title: "Galerie Anny",
                      description: "Fotky ze svatby",
                      imageUrl: null,
                      fetchedAt: null,
                      imageMediaId: null,
                      status: "ok" as const,
                    },
                  },
                },
              }
            : b,
        ),
    });
    for (const path of ["/", "/en"]) {
      await page.goto(`${site.url.replace(/\/$/, "")}${path}`);
      await expect(page.locator("#galerie a.site-linkcard")).toBeVisible();
      await expectNoViolations(page);
    }
  });

  test("chráněná karta: zamčená (formulář PINu)", async ({ page }) => {
    const site = await seedManagedSite({
      guestPin: GUEST_PIN,
      tweak: (blocks) =>
        blocks.map((b) =>
          b.type === "gallery"
            ? {
                ...b,
                enabled: true,
                data: {
                  mediaIds: [],
                  photosProtected: false,
                  link: {
                    url: `${OG_BASE}/galerie?t=tajne`,
                    label: { cs: "Tajná galerie" },
                    protected: true,
                    card: null,
                  },
                },
              }
            : b,
        ),
    });
    await page.goto(site.url);
    await expect(page.locator("#galerie").getByLabel("PIN z oznámení")).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("ovládání a zobrazení", () => {
  test("sekci jde zapnout, posunout a rozbalit jen klávesnicí, stav se hlásí čtečkám", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);

    const up = page.getByRole("button", { name: "Posunout sekci Dress code nahoru" });
    await up.focus();
    await page.keyboard.press("Enter");
    // oznámení pro čtečky je v živé oblasti; zaměření zůstalo na tlačítku
    await expect(page.getByTestId("moved")).toHaveText(
      "Sekce Dress code je nyní na pozici 4 z 11.",
    );
    await expect(page.getByTestId("moved")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator(":focus")).toHaveAttribute(
      "aria-label",
      "Posunout sekci Dress code nahoru",
    );

    await page.getByRole("button", { name: "Upravit sekci Dress code" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Sbalit sekci Dress code" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();

    // uložení hlásí živá oblast role=status (viditelný stav je skrytý před čtečkou, aby nezahlcoval)
    await block(page, "dresscode").getByLabel("Čeština").fill("Společenský oděv.");
    await expectSaved(page);
    await expect(page.getByRole("status").filter({ hasText: "Změny jsou uložené." })).toHaveCount(
      1,
    );
  });

  test("viditelný focus a cíle dotyku nejméně 44 px v editoru", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const outline = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement as HTMLElement);
        return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
      });
      expect(outline.style).not.toBe("none");
      expect(outline.width).toBeGreaterThanOrEqual(2);
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
                el.textContent?.trim() || el.getAttribute("aria-label") || el.getAttribute("name"),
              height: Math.max(r.height, box.height),
              width: Math.max(r.width, box.width),
            };
          })
          .filter((item) => item.height < 44 || item.width < 44),
      );
    expect(small).toEqual([]);
  });

  test("šířka 320 px: žádné vodorovné posouvání (WCAG 1.4.10)", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ["/", "/web", "/web/historie", "/napoveda"]) {
      await page.goto(appUrl(path));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    await openEditor(page);
    for (const name of ["Úvod", "Program", "Místo konání"]) {
      const type = { Úvod: "hero", Program: "program", "Místo konání": "venue" }[name]!;
      await openBlock(page, type, name);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("stránky mají vlastní nadpis stránky (title)", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    const titles: Record<string, string> = {
      "/": "Můj web | Se vezmou",
      "/web": "Upravit web | Se vezmou",
      "/web/historie": "Historie verzí | Se vezmou",
      "/napoveda": "Nápověda | Se vezmou",
    };
    for (const [path, title] of Object.entries(titles)) {
      await page.goto(appUrl(path));
      await expect(page).toHaveTitle(title);
    }
  });
});
