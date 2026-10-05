import { expect, test, type Page } from "@playwright/test";
import {
  appUrl,
  auditActions,
  block,
  blockOrder,
  expectSaved,
  GUEST_PIN,
  openBlock,
  openEditor,
  seedManagedSite,
  setPhase,
  versionsOf,
  weddingRow,
} from "./support/admin";
import { OG_BASE, OG_PAGES, ogHits } from "./support/og-server";

/**
 * Správa webu páru (M7a, FR-ADM-1 až FR-ADM-3, FR-WEB-2): úprava obsahu po jazycích, zapínání a řazení
 * bloků, průběžné ukládání, koncept a zveřejněná verze, stažení z publikace, historie s vrácením,
 * rychlá změna, překlady, šablona a paleta, dary a odkaz na externí galerii. Každý test si zakládá
 * vlastní web a relaci správce přímo v databázi; po každé akci čeká na viditelný výsledek.
 */

async function sectionIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("main > section")].map((section) => section.id),
  );
}

async function publish(page: Page, label = "Zveřejnit změny"): Promise<void> {
  await page.getByRole("button", { name: label }).click();
  const result = page.getByTestId("publish-result");
  await expect(result).toContainText(
    /Hotovo, web je zveřejněný ve verzi \d+|nejde zveřejnit|nepodařilo/,
  );
  // Při chybě test vypíše důvod (seznam chyb), ne jen "nenalezeno".
  const text = (await result.textContent()) ?? "";
  if (!/Hotovo/.test(text)) {
    throw new Error(
      `Zveřejnění selhalo: ${text} ${await page.getByTestId("issues").allInnerTexts()}`,
    );
  }
}

async function enterPin(page: Page, region: string, pin: string): Promise<void> {
  const scope = page.locator(region);
  await scope.getByLabel("PIN z oznámení").fill(pin);
  const response = page.waitForResponse((r) => r.request().method() === "POST");
  await scope.getByRole("button", { name: "Odemknout" }).click();
  await response;
  await expect(async () => {
    const values = await scope
      .getByLabel("PIN z oznámení")
      .evaluateAll((fields) => fields.map((field) => (field as HTMLInputElement).value));
    expect(values.every((value) => value === "")).toBe(true);
  }).toPass();
}

test.describe("přístup a rámec správy", () => {
  test("bez relace vede správa na přihlášení", async ({ page }) => {
    for (const path of ["/web", "/web/historie", "/napoveda", "/"]) {
      await page.goto(appUrl(path));
      await expect(page).toHaveURL(appUrl("/prihlaseni"));
    }
  });

  test("nápověda je na každé obrazovce na stejném místě (odkaz v nabídce vpravo, rámeček pod nadpisem)", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    for (const path of ["/", "/web", "/web/historie", "/napoveda"]) {
      await page.goto(appUrl(path));
      const nav = page.getByRole("navigation", { name: "Hlavní nabídka správy" });
      const links = await nav.getByRole("link").allTextContents();
      expect(links.at(-1)).toBe("Nápověda");
      const positions = await page.evaluate(() => {
        const main = document.querySelector("main")!;
        const heading = main.querySelector("h1")!;
        const help = main.querySelector('[data-testid="help-box"]')!;
        return (
          heading.nextElementSibling === help ||
          heading.nextElementSibling?.nextElementSibling === help
        );
      });
      expect(positions, path).toBe(true);
      await expect(
        page.getByTestId("help-box").getByText("Nápověda k této obrazovce"),
      ).toBeVisible();
    }
    await page.getByRole("link", { name: "Nápověda" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Nápověda" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Údaje za PINem" })).toBeVisible();
  });

  test("anglické rozhraní pod /en", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await page.goto(appUrl("/en/web"));
    await expect(page.getByRole("heading", { level: 1, name: "Edit website" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Help" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish changes" })).toBeVisible();
    await page.getByRole("link", { name: "Version history" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Version history" })).toBeVisible();
  });
});

test.describe("přehled Můj web", () => {
  test("ukazuje stav webu, adresu a odkazy do správy", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await page.goto(appUrl("/"));
    await expect(page.getByRole("heading", { level: 1, name: "Můj web" })).toBeVisible();
    await expect(page.getByTestId("overview-status")).toContainText("Web je zveřejněný (verze 1).");
    await expect(page.getByText(`${site.slug}.localhost`)).toBeVisible();
    await page.getByRole("link", { name: "Upravit web", exact: true }).first().click();
    await expect(page).toHaveURL(appUrl("/web"));
  });

  test("správce víc svateb si vybere, kterou spravuje", async ({ page, context }) => {
    const first = await seedManagedSite({ names: ["Klára", "Matěj"] });
    const second = await seedManagedSite({ names: ["Eva", "Petr"], adminEmail: first.adminEmail });
    await first.login(context);
    await page.goto(appUrl("/"));
    await expect(page.getByRole("heading", { level: 2, name: "Vaše svatby" })).toBeVisible();
    await expect(page.getByText("Právě spravujete")).toBeVisible();
    await expect(page.getByText(/Správa svatebního webu Klára a\s+Matěj/)).toBeVisible();

    await page.getByRole("button", { name: /Spravovat: Eva a\s+Petr/ }).click();
    await expect(page.getByText(/Správa svatebního webu Eva a\s+Petr/)).toBeVisible();
    await expect(page.getByText(`Adresa webu: ${second.slug}`)).toBeVisible();
    // nová relace patří druhé svatbě
    const row = await weddingRow(second.weddingId);
    expect(row.status).toBe("published");
  });

  test("svatba, kterou správci nepatří, se přepnout nedá ani podvrženým identifikátorem", async ({
    page,
    context,
  }) => {
    const mine = await seedManagedSite({ names: ["Klára", "Matěj"] });
    await seedManagedSite({ names: ["Eva", "Petr"], adminEmail: mine.adminEmail });
    const foreign = await seedManagedSite({ names: ["Cizí", "Pár"] });
    await mine.login(context);
    await page.goto(appUrl("/"));
    const switchButton = page.getByRole("button", { name: /Spravovat: Eva a\s+Petr/ });
    await switchButton.evaluate(
      (button, weddingId) => button.setAttribute("value", weddingId),
      foreign.weddingId,
    );
    await switchButton.click();
    await expect(page.getByText("Svatbu se nepodařilo přepnout.")).toBeVisible();
    await expect(page.getByText(/Správa svatebního webu Klára a\s+Matěj/)).toBeVisible();
    expect(await page.content()).not.toContain("Cizí");
  });
});

test.describe("editor webu: ukládání, koncept a publikace", () => {
  test("koncept se ukládá sám, hosté vidí až zveřejněnou verzi", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    await expect(page.getByTestId("site-status")).toContainText("odpovídá konceptu");

    const hero = await openBlock(page, "hero", "Úvod");
    await hero.getByLabel("Čeština").fill("Slavíme na zámku");
    await expectSaved(page);
    await expect(page.getByTestId("site-status")).toContainText("nezveřejněné změny");

    // hosté pořád vidí zveřejněnou verzi (koncept je jen pro správce)
    const guest = await context.newPage();
    await guest.goto(site.url);
    await expect(guest.getByRole("heading", { level: 1 })).toContainText("Klára");
    await expect(guest.locator("main")).not.toContainText("Slavíme na zámku");

    await publish(page);
    await expect(page.getByTestId("publish-result")).toContainText("verzi 2");
    await expect(page.getByTestId("site-status")).toContainText("odpovídá konceptu");
    await guest.reload();
    await expect(guest.locator("main")).toContainText("Slavíme na zámku");

    // po obnovení stránky je koncept i zveřejněná verze na místě
    await page.reload();
    const again = await openBlock(page, "hero", "Úvod");
    await expect(again.getByLabel("Čeština")).toHaveValue("Slavíme na zámku");
    expect(await versionsOf(site.weddingId)).toMatchObject([
      { version_no: 1 },
      { version_no: 2, kind: "publish" },
    ]);
    expect(await auditActions(site.weddingId)).toContain("site.published");
  });

  test("změna jmen a data se ukáže v náhledu i na webu po zveřejnění", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    await page.getByLabel("Jméno první osoby").fill("Kamila");
    await expectSaved(page);
    const frame = page.frameLocator('iframe[data-testid="site-preview-frame"]');
    await expect(frame.getByRole("heading", { level: 1 })).toContainText("Kamila");
    await publish(page);
    const guest = await context.newPage();
    await guest.goto(site.url);
    await expect(guest.getByRole("heading", { level: 1 })).toContainText("Kamila");
  });

  test("zapnutí a vypnutí sekce se projeví na webu po zveřejnění", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    await block(page, "dresscode")
      .getByRole("checkbox", { name: "Zobrazit na webu: Dress code" })
      .uncheck();
    await expect(block(page, "dresscode")).toHaveAttribute("data-enabled", "false");
    await expectSaved(page);
    await publish(page);
    const guest = await context.newPage();
    await guest.goto(site.url);
    await expect(guest.locator("#dresscode")).toHaveCount(0);

    await block(page, "dresscode")
      .getByRole("checkbox", { name: "Zobrazit na webu: Dress code" })
      .check();
    await expect(block(page, "dresscode")).toHaveAttribute("data-enabled", "true");
    await expectSaved(page);
    await publish(page);
    await guest.reload();
    await expect(guest.locator("#dresscode")).toContainText("Slavnostní, bez bílé.");
  });

  test("ubytování s adresou a zaškrtnutou mapou se ukáže na mapě místa konání", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    const lodging = await openBlock(page, "lodging", "Ubytování a doprava");
    await lodging.getByRole("checkbox", { name: "Zobrazit na webu: Ubytování a doprava" }).check();
    await lodging.getByRole("button", { name: "Přidat ubytování" }).click();
    await lodging.getByLabel("Čeština").first().fill("Penzion U Řeky");
    await lodging.getByLabel("Adresa ubytování").fill("Říční 5, Dobřichovice");
    await lodging.getByRole("checkbox", { name: "Zobrazit na mapě místa konání" }).check();
    // souřadnice se hledají na serveru (v testech pevný bod, MAP_STUB)
    await expect(lodging.getByText("Místo je na mapě")).toBeVisible();
    await expectSaved(page);
    await publish(page);

    const guest = await context.newPage();
    await guest.goto(site.url);
    const venue = guest.locator("#misto");
    await expect(venue.locator('.site-map-pin[data-kind="lodging"]')).toHaveCount(1);
    await expect(venue.getByRole("img", { name: /Penzion U\sŘeky/ })).toBeVisible();
    await expect(guest.locator("#ubytovani")).toContainText("Říční 5, Dobřichovice");
  });

  test("úvod je vždy první a zapnutý, jeho pořadí nejde měnit", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    const hero = block(page, "hero");
    await expect(hero.getByRole("checkbox")).toHaveCount(0);
    await expect(hero.getByRole("button", { name: /Posunout sekci/ })).toHaveCount(0);
    await expect(hero).toContainText("Vždy první");
    expect((await blockOrder(page))[0]).toBe("hero");
  });

  test("stažení z publikace skryje web, znovu zveřejnění ho vrátí", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    const guest = await context.newPage();
    const online = await guest.goto(site.url);
    expect(online?.status()).toBe(200);

    await page.getByRole("button", { name: "Stáhnout z publikace" }).click();
    await expect(page.getByText("Opravdu stáhnout web z publikace?")).toBeVisible();
    await page.getByRole("button", { name: "Ano, stáhnout" }).click();
    await expect(page.getByTestId("publish-result")).toContainText("Web je stažený z publikace");
    await expect(page.getByTestId("site-status")).toContainText("Web je koncept");
    expect((await weddingRow(site.weddingId)).status).toBe("draft");
    const offline = await guest.goto(site.url);
    expect(offline?.status()).toBe(404);
    expect(await auditActions(site.weddingId)).toContain("site.unpublished");

    // po stažení jde koncept dál upravovat a znovu zveřejnit; průvodce ho nepřevezme
    await page.goto(appUrl("/vytvorit"));
    await expect(page).toHaveURL(appUrl("/"));
    await openEditor(page);
    await page.getByRole("button", { name: "Zveřejnit web" }).click();
    await expect(page.getByTestId("publish-result")).toContainText("verzi 2");
    const back = await guest.goto(site.url);
    expect(back?.status()).toBe(200);
  });

  test("neúplný web (chybí jméno) nejde zveřejnit a chyba odkazuje na místo opravy", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    await page.getByLabel("Jméno druhé osoby").fill("");
    await expectSaved(page);
    await page.getByRole("button", { name: "Zveřejnit změny" }).click();
    await expect(page.getByTestId("publish-result")).toContainText("Web zatím nejde zveřejnit");
    await expect(page.getByTestId("issues")).toContainText("Vyplňte obě jména.");
    await page
      .getByTestId("issues")
      .getByRole("button", { name: "Přejít k opravě" })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 2, name: "Obecné" })).toBeFocused();
    expect((await versionsOf(site.weddingId)).length).toBe(1);
  });
});

test.describe("řazení sekcí (WCAG 2.5.7)", () => {
  test("tlačítka nahoru a dolů: pořadí, oznámení, zaměření, uložení i web", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    expect((await blockOrder(page)).slice(0, 3)).toEqual(["hero", "program", "venue"]);

    const down = page.getByRole("button", { name: "Posunout sekci Program dolů" });
    await down.click();
    await expect(page.getByTestId("moved")).toHaveText("Sekce Program je nyní na pozici 3 z 11.");
    expect((await blockOrder(page)).slice(0, 3)).toEqual(["hero", "venue", "program"]);
    // zaměření zůstalo na stejném tlačítku (po přeskupení DOM ho nikdo nepřevzal)
    await expect(page.locator(":focus")).toHaveAttribute(
      "aria-label",
      "Posunout sekci Program dolů",
    );
    await expectSaved(page);

    // klávesnicí: tlačítko nahoru u sekce Dress code, zaměření zůstává na tlačítku i při dalším stisku
    await page.getByRole("button", { name: "Posunout sekci Dress code nahoru" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("moved")).toHaveText(
      "Sekce Dress code je nyní na pozici 4 z 11.",
    );
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("moved")).toHaveText(
      "Sekce Dress code je nyní na pozici 3 z 11.",
    );
    await expectSaved(page);

    // krajní polohy: první sekce pod úvodem nejde posunout výš, poslední níž
    await expect(
      page.getByRole("button", { name: "Posunout sekci Místo konání nahoru" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Posunout sekci Potvrzení účasti dolů" }),
    ).toBeDisabled();

    await page.reload();
    expect((await blockOrder(page)).slice(0, 4)).toEqual(["hero", "venue", "dresscode", "program"]);

    await publish(page);
    const guest = await context.newPage();
    await guest.goto(site.url);
    const ids = await sectionIds(guest);
    expect(ids.indexOf("misto")).toBeLessThan(ids.indexOf("dresscode"));
    expect(ids.indexOf("dresscode")).toBeLessThan(ids.indexOf("program"));
  });

  test("přetažením myší", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    await block(page, "dresscode").dragTo(block(page, "program"), {
      sourcePosition: { x: 20, y: 24 },
      targetPosition: { x: 40, y: 10 },
    });
    await expect(page.getByTestId("moved")).toContainText(
      "Sekce Dress code je nyní na pozici 2 z 11.",
    );
    expect((await blockOrder(page)).slice(0, 3)).toEqual(["hero", "dresscode", "program"]);
    await expectSaved(page);
  });
});

test.describe("historie verzí a vrácení", () => {
  test("verze se vracejí jako koncept, současný stav se předtím zachytí", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    const hero = await openBlock(page, "hero", "Úvod");
    await hero.getByLabel("Čeština").fill("Druhá verze podtitulu");
    await expectSaved(page);
    await publish(page);

    await page.getByRole("link", { name: "Historie verzí" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Historie verzí" })).toBeVisible();
    await expect(page.getByTestId("version-2")).toContainText("Právě zveřejněná");
    await expect(page.getByTestId("version-1")).toContainText("Zveřejněná verze");
    await expect(page.getByTestId("version-2").getByRole("button")).toHaveCount(0);

    await page.getByRole("button", { name: "Vrátit tuto verzi: verze 1" }).click();
    await expect(page.getByText(/Vrátit verzi 1\?/)).toBeVisible();
    await page.getByRole("button", { name: "Ano, vrátit verzi" }).click();
    await expect(page.getByTestId("history-result")).toContainText(
      "Verze 1 je načtená jako koncept",
    );

    // hosté pořád vidí verzi 2, koncept je původní
    const guest = await context.newPage();
    await guest.goto(site.url);
    await expect(guest.locator("main")).toContainText("Druhá verze podtitulu");
    await page.getByRole("link", { name: "Upravit a zveřejnit" }).click();
    await expect(page).toHaveURL(appUrl("/web"));
    const restored = await openBlock(page, "hero", "Úvod");
    await expect(restored.getByLabel("Čeština")).toHaveValue("");
    await expect(page.getByTestId("site-status")).toContainText("nezveřejněné změny");

    // před vrácením vznikl bod pro vrácení se současným stavem (verze 3), zveřejněná je pořád 2
    const versions = await versionsOf(site.weddingId);
    expect(versions.map((v) => [v.version_no, v.kind])).toEqual([
      [1, "publish"],
      [2, "publish"],
      [3, "checkpoint"],
    ]);
    expect(versions[2].note).toBe("Před vrácením verze 1");

    // a ten bod jde vrátit zpátky
    await page.goto(appUrl("/web/historie"));
    await page.getByRole("button", { name: "Vrátit tuto verzi: verze 3" }).click();
    await page.getByRole("button", { name: "Ano, vrátit verzi" }).click();
    await expect(page.getByTestId("history-result")).toContainText(
      "Verze 3 je načtená jako koncept",
    );
    await page.goto(appUrl("/web"));
    const back = await openBlock(page, "hero", "Úvod");
    await expect(back.getByLabel("Čeština")).toHaveValue("Druhá verze podtitulu");
  });

  test("bod pro vrácení se uloží tlačítkem a nic nezveřejní", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    await page.getByLabel("Poznámka k verzi (nepovinné)").fill("Před úpravou programu");
    await page.getByRole("button", { name: "Uložit bod pro vrácení" }).click();
    await expect(page.getByTestId("publish-result")).toContainText(
      "Bod pro vrácení je uložený jako verze 2.",
    );
    const versions = await versionsOf(site.weddingId);
    expect(versions[1]).toMatchObject({
      version_no: 2,
      kind: "checkpoint",
      note: "Před úpravou programu",
    });
    await page.goto(appUrl("/web/historie"));
    await expect(page.getByTestId("version-2")).toContainText("Bod pro vrácení");
    await expect(page.getByTestId("version-2")).toContainText("Před úpravou programu");
  });
});

test.describe("rychlá změna (FR-ADM-3)", () => {
  test("pruh nahoře na webu platí hned bez nové publikace a jde vypnout", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await page.goto(appUrl("/"));
    const guest = await context.newPage();
    await guest.goto(site.url);
    await expect(guest.locator(".site-notice")).toHaveCount(0);

    await page.getByLabel("Čeština").fill("Obřad začíná o hodinu dřív.");
    await page.getByLabel("English").fill("The ceremony starts an hour earlier.");
    await page.getByLabel("Zobrazit pruh na webu").check();
    await page.getByRole("button", { name: "Uložit rychlou změnu" }).click();
    await expect(page.getByText("Pruh je na webu.")).toBeVisible();

    await guest.reload();
    await expect(guest.locator(".site-notice")).toContainText("Obřad začíná o hodinu dřív.");
    await guest.goto(`${site.url}en`);
    await expect(guest.locator(".site-notice")).toContainText(
      "The ceremony starts an hour earlier.",
    );
    expect((await versionsOf(site.weddingId)).length).toBe(1);

    await page.getByLabel("Zobrazit pruh na webu").uncheck();
    await page.getByRole("button", { name: "Uložit rychlou změnu" }).click();
    await expect(page.getByText("Pruh je skrytý, text zůstal uložený.")).toBeVisible();
    await guest.goto(site.url);
    await expect(guest.locator(".site-notice")).toHaveCount(0);
    const row = await weddingRow(site.weddingId);
    expect(row.quick_notice_enabled).toBe(false);
    expect(row.quick_notice?.cs).toBe("Obřad začíná o hodinu dřív.");
    expect(await auditActions(site.weddingId)).toContain("site.quick_notice");
  });

  test("zapnout pruh bez textu nejde, chyba je slovy", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await page.goto(appUrl("/"));
    await page.getByLabel("Zobrazit pruh na webu").check();
    await page.getByRole("button", { name: "Uložit rychlou změnu" }).click();
    await expect(page.getByText("Napište text pruhu, nebo pruh vypněte.")).toBeVisible();
    expect((await weddingRow(site.weddingId)).quick_notice_enabled).toBe(false);
  });

  test("rychlá změna je i v editoru a promítne se do náhledu", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    const panel = page.getByRole("region", { name: "Rychlá změna" });
    await panel.getByLabel("Čeština").fill("Nezapomeňte deštníky.");
    await panel.getByLabel("Zobrazit pruh na webu").check();
    await panel.getByRole("button", { name: "Uložit rychlou změnu" }).click();
    await expect(panel.getByText("Pruh je na webu.")).toBeVisible();
    const frame = page.frameLocator('iframe[data-testid="site-preview-frame"]');
    await expect(frame.locator(".site-notice")).toContainText("Nezapomeňte deštníky.");
  });
});

test.describe("překlady (FR-WEB-2)", () => {
  test("chybějící překlad se hlásí správci a web ukáže dostupný jazyk", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    await expect(page.getByTestId("translation-gaps")).toContainText(
      "Dress code: v jazyce English chybí 1 text.",
    );

    const dress = await openBlock(page, "dresscode", "Dress code");
    await expect(dress).toContainText("Chybí překlad: English");

    // chybějící překlad zveřejnění nebrání; anglická verze ukáže český text a označí jeho jazyk
    await publish(page);
    const guest = await context.newPage();
    await guest.goto(`${site.url}en`);
    const paragraph = guest.locator("#dresscode p", { hasText: "Slavnostní, bez bílé." });
    await expect(paragraph).toBeVisible();
    await expect(paragraph).toHaveAttribute("lang", "cs");

    await dress.getByLabel("English").fill("Formal, no white.");
    await expectSaved(page);
    await expect(page.getByTestId("translations-ok")).toBeVisible();
    await publish(page);
    await guest.reload();
    await expect(guest.locator("#dresscode")).toContainText("Formal, no white.");
  });

  test("jazyky webu: vypnutí angličtiny odebere anglickou verzi", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    await page.getByRole("checkbox", { name: "English" }).first().uncheck();
    await expectSaved(page);
    await expect(page.getByTestId("translations-ok")).toHaveCount(0);
    await publish(page);
    const guest = await context.newPage();
    const response = await guest.goto(`${site.url}en`);
    expect(response?.status()).toBe(404);
    // poslední jazyk jde vypnout jen tak, že zůstane aspoň jeden
    await expect(page.getByRole("checkbox", { name: "Čeština" }).first()).toBeDisabled();
  });
});

test.describe("šablona a paleta (FR-WEB-3)", () => {
  test("změna šablony a barev se projeví na webu po zveřejnění, každá paleta má ověřený kontrast", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    await expect(page.getByRole("radio", { name: /Slonová kost/ })).toBeChecked();
    await page.getByRole("radio", { name: "Modern" }).check();
    await page.getByRole("radio", { name: /Kobalt/ }).check();
    await expectSaved(page);
    await expect(page.getByText("Kontrast v pořádku").first()).toBeVisible();
    await publish(page);
    const guest = await context.newPage();
    await guest.goto(site.url);
    await expect(guest.locator(".site-root")).toHaveAttribute("data-template", "modern");
    await expect(guest.locator(".site-root")).toHaveAttribute("data-palette", "kobalt");
  });
});

test.describe("program a místa", () => {
  test("přidání události a soukromého místa, odebrání události, program po hodinách", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite({ guestPin: GUEST_PIN });
    await site.login(context);
    await openEditor(page);
    const program = await openBlock(page, "program", "Program");
    await program.getByRole("button", { name: "Přidat událost" }).click();
    // nová událost je podle času (12:00) první; po zadání času 20:00 se zařadí na třetí místo
    const added = program.getByRole("group", { name: "Událost 1" });
    await added.getByLabel("Čeština").first().fill("První tanec");
    await added.getByLabel("English").first().fill("First dance");
    await added.getByLabel("Začátek").fill("20:00");
    await expect(
      program.getByRole("group", { name: "Událost 3" }).getByLabel("Čeština").first(),
    ).toHaveValue("První tanec");
    await expectSaved(page);

    const venue = await openBlock(page, "venue", "Místo konání");
    await venue.getByRole("button", { name: "Přidat místo" }).click();
    const place = venue.getByRole("group", { name: "Místo 2" });
    await place.getByLabel("Čeština").first().fill("Zahrada u rodičů");
    await place.getByLabel("English").first().fill("Parents’ garden");
    await place.getByLabel("Adresa", { exact: true }).fill("Tajná zahrada 77, Praha");
    await place.getByLabel("Adresu zobrazit jen po zadání PINu hostů").check();
    await venue.getByRole("checkbox", { name: "Zahrada u rodičů" }).check();
    await expectSaved(page);
    await publish(page);

    const guest = await context.newPage();
    await guest.goto(site.url);
    await expect(guest.locator("#program")).toContainText("První tanec");
    await expect(guest.locator("#program")).toContainText("20:00");
    // adresa soukromého místa není v dokumentu, dokud host nezadá PIN
    expect(await guest.content()).not.toContain("Tajná zahrada 77");
    await expect(guest.locator("#misto")).toContainText("Zahrada u rodičů");
    await enterPin(guest, "#misto", GUEST_PIN);
    await expect(guest.locator("#misto")).toContainText("Tajná zahrada 77, Praha");

    // odebrání události
    await program.getByRole("button", { name: "Odebrat událost 3" }).click();
    await expectSaved(page);
    await publish(page);
    await guest.goto(site.url);
    await expect(guest.locator("#program")).not.toContainText("První tanec");
  });
});

test.describe("dary: číslo účtu a QR za PINem", () => {
  test("neplatné číslo účtu zveřejnění zastaví, platné se na webu ukáže až po PINu", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite({ guestPin: GUEST_PIN });
    await site.login(context);
    await openEditor(page);
    await block(page, "gifts").getByRole("checkbox", { name: "Zobrazit na webu: Dary" }).check();
    const gifts = block(page, "gifts");
    await gifts.getByLabel("Číslo účtu").fill("124/0100");
    await expect(gifts.getByText(/Číslo účtu nesouhlasí/)).toBeVisible();
    await expectSaved(page);
    await page.getByRole("button", { name: "Zveřejnit změny" }).click();
    await expect(page.getByTestId("publish-result")).toContainText("Web zatím nejde zveřejnit");
    await expect(page.getByTestId("issues")).toContainText("Číslo účtu v sekci Dary nesouhlasí");

    await gifts.getByLabel("Číslo účtu").fill("19-2000145399/0800");
    await gifts.getByLabel("Majitel účtu (nepovinné)").fill("Klára Nováková");
    await expect(
      gifts.getByRole("img", { name: /Ukázka QR platby na účet 19-2000145399\/0800/ }),
    ).toBeVisible();
    await expect(gifts).toContainText("IBAN CZ6508000000192000145399");
    await expectSaved(page);
    await publish(page);

    const guest = await context.newPage();
    await guest.goto(site.url);
    const html = await guest.content();
    expect(html).not.toContain("19-2000145399");
    expect(html).not.toContain("Klára Nováková");
    await enterPin(guest, "#dary", GUEST_PIN);
    await expect(guest.locator("#dary")).toContainText("19-2000145399/0800");
    await expect(guest.locator("#dary")).toContainText("Klára Nováková");
    await expect(guest.locator("#dary svg.site-qr")).toBeVisible();
  });
});

test.describe("odkaz na externí fotogalerii", () => {
  async function enableLink(page: Page, url: string) {
    const gallery = await openBlock(page, "gallery", "Fotografie");
    if (
      !(await block(page, "gallery")
        .getByRole("checkbox", { name: "Zobrazit na webu: Fotografie" })
        .isChecked())
    ) {
      await block(page, "gallery")
        .getByRole("checkbox", { name: "Zobrazit na webu: Fotografie" })
        .check();
    }
    await gallery.getByLabel("Přidat odkaz na externí fotogalerii").check();
    await gallery.getByLabel("Adresa galerie").fill(url);
    await gallery.getByLabel("Adresa galerie").blur();
    return gallery;
  }

  test("veřejný odkaz: server načte kartu, web ji ukáže před i po svatbě a nevolá cizí web", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    const path = `/galerie?t=${site.tag}`;
    const gallery = await enableLink(page, `${OG_BASE}${path}`);
    await expect(gallery.getByText("Náhled odkazu se načetl.")).toBeVisible();
    await expect(gallery).toContainText(OG_PAGES.galerie.title);
    expect(await ogHits(path)).toBe(1);
    await expectSaved(page);
    await publish(page);
    // uložení a zveřejnění nesáhlo na cílový server podruhé
    expect(await ogHits(path)).toBe(1);

    const guest = await context.newPage();
    const hosts = new Set<string>();
    guest.on("request", (request) => hosts.add(new URL(request.url()).hostname));
    for (const phase of ["rsvp_open", "thanks"]) {
      await setPhase(site.weddingId, phase);
      await guest.goto(site.url);
      const card = guest.locator("#galerie a.site-linkcard");
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute("href", `${OG_BASE}${path}`);
      await expect(card).toHaveAttribute("target", "_blank");
      await expect(card).toHaveAttribute("rel", "noopener noreferrer");
      await expect(card).toContainText(OG_PAGES.galerie.title);
      await expect(card).toContainText(`${OG_PAGES.galerie.description} & videa`);
      await expect(card).toContainText("Odkaz se otevře na jiném webu");
      await expect(card).toContainText("fotky-test.example");
      // obrázek karty je KOPIE ve vlastním úložišti (M7c): vlastní adresa, dekorativní (prázdné alt)
      const image = guest.locator("#galerie a.site-linkcard img");
      await expect(image).toHaveCount(1);
      await expect(image).toHaveAttribute("src", /^\/media\/[0-9a-f-]{36}\/\d+\?f=webp$/);
      await expect(image).toHaveAttribute("alt", "");
      await guest.goto(`${site.url}en`);
      await expect(guest.locator("#galerie a.site-linkcard")).toContainText(
        "Link opens on another website",
      );
    }
    // hosté a jejich prohlížeče nevolají cizí web: jen vlastní původ webu páru
    expect([...hosts]).toEqual([`${site.slug}.localhost`]);
    expect(await ogHits(path)).toBe(1);
    // obrázek stáhl server jednou při načtení karty, hosté ho od cizího serveru nikdy nenačítají
    expect(await ogHits(`/cover.jpg?t=${site.tag}`)).toBe(1);
  });

  test("název od páru po jazycích přepíše název z cílové stránky", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    const gallery = await enableLink(page, `${OG_BASE}/galerie?t=${site.tag}-n`);
    await expect(gallery.getByText("Náhled odkazu se načetl.")).toBeVisible();
    await gallery.getByLabel("Čeština").fill("Fotky od Anny");
    await gallery.getByLabel("English").fill("Photos by Anna");
    await expectSaved(page);
    await publish(page);
    const guest = await context.newPage();
    await guest.goto(site.url);
    await expect(guest.locator("#galerie a.site-linkcard")).toContainText("Fotky od Anny");
    await expect(guest.locator("#galerie")).not.toContainText(OG_PAGES.galerie.title);
    await guest.goto(`${site.url}en`);
    await expect(guest.locator("#galerie a.site-linkcard")).toContainText("Photos by Anna");
  });

  test("titulek a popis z cizí stránky jsou jen text (žádné značky, žádný skript)", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    const gallery = await enableLink(page, `${OG_BASE}/zneuzivani?t=${site.tag}`);
    await expect(gallery.getByText("Náhled odkazu se načetl.")).toBeVisible();
    await expectSaved(page);
    await publish(page);
    const guest = await context.newPage();
    guest.on("dialog", () => {
      throw new Error("Cizí text spustil skript");
    });
    await guest.goto(site.url);
    const card = guest.locator("#galerie a.site-linkcard");
    await expect(card).toContainText("<img src=x onerror=alert(1)>");
    await expect(card).toContainText("<script>alert(1)</script>");
    await expect(guest.locator("#galerie img")).toHaveCount(0);
    await expect(guest.locator("#galerie script")).toHaveCount(0);
  });

  for (const [name, path] of [
    ["stránka bez og značek", "/bez-og"],
    ["jiný typ obsahu", "/pdf"],
    ["přesměrování na loopback (SSRF)", "/presmerovani"],
    ["přesměrování na http", "/presmerovani-http"],
    ["chráněná stránka", "/chraneno"],
    ["neexistující stránka", "/neexistuje"],
  ] as const) {
    test(`selhání načtení (${name}) neblokuje uložení, karta spadne na doménu a text odkazu`, async ({
      page,
      context,
    }) => {
      const site = await seedManagedSite();
      await site.login(context);
      await openEditor(page);
      const gallery = await enableLink(page, `${OG_BASE}${path}?t=${site.tag}`);
      await expect(gallery.getByText(/Náhled se nepodařilo načíst/)).toBeVisible();
      await gallery.getByLabel("Čeština").fill("Moje fotky");
      await expectSaved(page);
      await publish(page);
      const guest = await context.newPage();
      await guest.goto(site.url);
      const card = guest.locator("#galerie a.site-linkcard");
      await expect(card).toContainText("Moje fotky");
      await expect(card).toContainText("fotky-test.example");
      await expect(card).toContainText("Odkaz se otevře na jiném webu");
    });
  }

  test("odkaz bez https se nenačítá a zveřejnění zastaví", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    const path = `/galerie?t=${site.tag}-http`;
    const gallery = await enableLink(page, `http://fotky-test.example${path}`);
    await expect(
      gallery.getByText("Odkaz musí začínat https:// a vést na veřejný web.").first(),
    ).toBeVisible();
    expect(await ogHits(path)).toBe(0);
    await expectSaved(page);
    await page.getByRole("button", { name: "Zveřejnit změny" }).click();
    await expect(page.getByTestId("issues")).toContainText(
      "Odkaz na galerii musí začínat https://.",
    );
    await gallery.getByLabel("Adresa galerie").fill("javascript:alert(1)");
    await expect(gallery.getByText("Odkaz musí začínat https://").first()).toBeVisible();
  });

  test("tlačítko Obnovit náhled načte stránku znovu, počet obnovení je omezený", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await openEditor(page);
    const path = `/galerie?t=${site.tag}-r`;
    const gallery = await enableLink(page, `${OG_BASE}${path}`);
    await expect(gallery.getByText("Náhled odkazu se načetl.")).toBeVisible();
    expect(await ogHits(path)).toBe(1);
    await gallery.getByRole("button", { name: "Obnovit náhled odkazu" }).click();
    await expect(gallery.getByRole("button", { name: "Obnovit náhled odkazu" })).toBeEnabled();
    await expect.poll(() => ogHits(path)).toBe(2);
  });

  test("odkaz jen po PINu hostů: bez PINu není ani v HTML, ani v RSC; s PINem je vidět", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite({ guestPin: GUEST_PIN });
    await site.login(context);
    await openEditor(page);
    const path = `/galerie?t=${site.tag}-p`;
    const gallery = await enableLink(page, `${OG_BASE}${path}`);
    await expect(gallery.getByText("Náhled odkazu se načetl.")).toBeVisible();
    await gallery.getByLabel("Zobrazit odkaz jen po zadání PINu hostů").check();
    await expect(gallery).toContainText("Odkaz s tajným tokenem je sám o sobě přístup do galerie");
    await expectSaved(page);
    await publish(page);

    const guest = await context.newPage();
    await guest.goto(site.url);
    const secrets = [path, "Galerie Anny", "Fotky ze svatby"];
    const html = await guest.content();
    for (const secret of secrets) expect(html).not.toContain(secret);
    await expect(guest.locator("#galerie").getByLabel("PIN z oznámení")).toBeVisible();
    const rsc = await guest.evaluate(async () => {
      const response = await fetch(`${location.pathname}?_rsc=test`, {
        headers: { RSC: "1", "Next-Url": location.pathname },
      });
      return response.text();
    });
    expect(rsc.length).toBeGreaterThan(5000);
    for (const secret of secrets) expect(rsc).not.toContain(secret);

    await enterPin(guest, "#galerie", GUEST_PIN);
    const card = guest.locator("#galerie a.site-linkcard");
    await expect(card).toHaveAttribute("href", `${OG_BASE}${path}`);
    await expect(card).toContainText("Galerie Anny");
  });
});

test.describe("souběžná úprava ve dvou oknech", () => {
  test("druhé okno nepřepíše cizí změny: hlásí konflikt a nabídne načtení", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite();
    await site.login(context);
    const other = await context.newPage();
    await openEditor(page);
    await openEditor(other);

    const first = await openBlock(page, "hero", "Úvod");
    await first.getByLabel("Čeština").fill("Z prvního okna");
    await expectSaved(page);

    const second = await openBlock(other, "hero", "Úvod");
    await second.getByLabel("Čeština").fill("Z druhého okna");
    await expect(other.getByTestId("save-state")).toContainText(
      "Web jste mezitím změnili v jiném okně.",
    );
    await expect(
      other.getByRole("alert").filter({ hasText: "Web se mezitím změnil v jiném okně" }),
    ).toBeVisible();

    await other.getByRole("link", { name: "Načíst aktuální verzi" }).click();
    const reloaded = await openBlock(other, "hero", "Úvod");
    await expect(reloaded.getByLabel("Čeština")).toHaveValue("Z prvního okna");
  });
});

test.describe("izolace svateb ve správě", () => {
  test("správce vidí a mění jen svou svatbu", async ({ page, context }) => {
    const mine = await seedManagedSite({ names: ["Klára", "Matěj"] });
    const other = await seedManagedSite({ names: ["Alena", "Petr"] });
    await mine.login(context);
    await openEditor(page);
    await expect(page.getByLabel("Jméno první osoby")).toHaveValue("Klára");
    expect(await page.content()).not.toContain("Alena");
    expect(await page.content()).not.toContain(other.slug);
    const hero = await openBlock(page, "hero", "Úvod");
    await hero.getByLabel("Čeština").fill("Jen moje");
    await expectSaved(page);
    const guest = await context.newPage();
    await guest.goto(other.url);
    await expect(guest.locator("main")).not.toContainText("Jen moje");
    expect((await versionsOf(other.weddingId)).length).toBe(1);
  });
});
