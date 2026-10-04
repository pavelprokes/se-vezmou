import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { toXlsx } from "../src/lib/export/xlsx";
import { appUrl, GUEST_PIN, loginAs } from "./support/admin";
import { withDb } from "./support/db";
import { expect, test } from "./support/fixtures";
import {
  activeAdminEmails,
  backupEmail,
  grantRows,
  guestPinState,
  guestRows,
  responseRows,
  rsvpSettingsRow,
  seedHouseholds,
  seedSite,
  sessionState,
} from "./support/guests";
import { readMails, waitForMail } from "./support/mail";
import { admin, auditRows, loginAsOperator, seedOperator } from "./support/ops";

/**
 * Správa hostů, odpovědí a přístupu (M7b, FR-ADM-4, FR-ADM-5, FR-PRIV-2, OQ-53): ruční zápis a úprava
 * domácností, import z CSV a Excelu s náhledem, export, přehled odpovědí a ruční zápis odpovědi,
 * nastavení RSVP a vlastní otázky, správci a oznámení e-mailem, záložní e-mail, PIN, souhlas s nahlédnutím
 * provozovatele včetně oznámení o skutečném nahlédnutí, smazání webu a izolace mezi svatbami.
 * Každý test si zakládá vlastní web a relaci; po každé akci čeká na viditelný výsledek.
 */

const csv = (text: string) => Buffer.from(`﻿${text}`, "utf8");

/** Typografie vkládá nezlomitelné mezery (za jednopísmenné předložky i do čísel); porovnání je bere jako mezery. */
const norm = (text: string) => text.replace(/\s/g, " ");
const subject = async (to: string, count = 1) => norm((await waitForMail(to, count)).subject);

async function waitSaved(page: Page, text: string | RegExp = "Uloženo.") {
  await expect(page.getByText(text, { exact: typeof text === "string" }).first()).toBeVisible();
}

/** Karta jednoho hosta v editoru domácnosti. */
const guestCard = (page: Page, n: number): Locator =>
  page.getByRole("article", { name: `Host ${n}`, exact: true });

test.describe("seznam hostů a domácností", () => {
  test("ruční zápis, úprava a smazání domácnosti včetně dítěte a pozvání na události", async ({
    page,
    context,
  }) => {
    const site = await seedSite();
    await site.login(context);
    await page.goto(appUrl("/hoste"));
    await expect(page.getByRole("heading", { level: 1, name: "Hosté" })).toBeVisible();
    await expect(page.getByText(/Zatím tu nikdo není/)).toBeVisible();

    await page.getByRole("link", { name: "Přidat domácnost" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Nová domácnost" })).toBeVisible();

    // prázdné jméno: chyba u pole slovy, nic se neuloží
    await page.getByRole("button", { name: "Uložit domácnost" }).click();
    await expect(page.getByText("Vyplňte jméno hosta.")).toBeVisible();
    await expect(page.getByLabel("Jméno a příjmení")).toBeFocused();
    expect(await guestRows(site.weddingId)).toHaveLength(0);

    await page.getByLabel("Název domácnosti").fill("Dvořákovi");
    await page.getByLabel("Jméno a příjmení").fill("Karel Dvořák");
    await page.getByRole("button", { name: "Přidat dalšího hosta" }).click();
    const second = guestCard(page, 2);
    await expect(second.getByLabel("Jméno a příjmení")).toBeFocused();
    await second.getByLabel("Jméno a příjmení").fill("Anička Dvořáková");
    await second.getByLabel("Je to dítě").check();
    await second.getByLabel("Věk dítěte").fill("osm");
    await page.getByRole("button", { name: "Uložit domácnost" }).click();
    await expect(second.getByText("Věk zadejte jako celé číslo od 0 do 17")).toBeVisible();
    await second.getByLabel("Věk dítěte").fill("8");
    await second.getByLabel("Hostina").uncheck();
    await page.getByRole("button", { name: "Uložit domácnost" }).click();

    await expect(page.getByRole("heading", { level: 2, name: "Dvořákovi" })).toBeVisible();
    await waitSaved(page);
    await expect(page.getByTestId("guest-count")).toHaveText("Domácností: 1, hostů: 2");
    await expect(page.getByText("dítě, 8 let")).toBeVisible();
    await expect(
      page.getByText("pozván(a): Svatební obřad", { exact: false }).first(),
    ).toBeVisible();

    const saved = await guestRows(site.weddingId);
    expect(saved.map((g) => [g.display_name, g.is_child, g.age, g.source, g.invitations])).toEqual([
      ["Anička Dvořáková", true, 8, "manual", 1],
      ["Karel Dvořák", false, null, "manual", 2],
    ]);

    // úprava: přejmenování a odebrání dítěte
    await page.getByRole("link", { name: "Upravit domácnost Dvořákovi" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Úprava domácnosti" })).toBeVisible();
    await expect(guestCard(page, 1).getByLabel("Jméno a příjmení")).toHaveValue("Karel Dvořák");
    await guestCard(page, 1).getByLabel("Jméno a příjmení").fill("Karel Dvořák st.");
    await page.getByRole("button", { name: "Odebrat hosta Anička Dvořáková" }).click();
    await expect(guestCard(page, 2)).toHaveCount(0);
    await page.getByRole("button", { name: "Uložit domácnost" }).click();
    await waitSaved(page);
    await expect(page.getByText("Karel Dvořák st.")).toBeVisible();
    expect((await guestRows(site.weddingId)).map((g) => g.display_name)).toEqual([
      "Karel Dvořák st.",
    ]);

    // smazání s potvrzením
    await page.getByRole("link", { name: "Upravit domácnost Dvořákovi" }).click();
    await page.getByRole("button", { name: "Smazat domácnost" }).click();
    await expect(page.getByText(/Smazat celou domácnost včetně hostů/)).toBeVisible();
    await page.getByRole("button", { name: "Ano, smazat" }).click();
    await waitSaved(page, "Domácnost je smazaná.");
    await expect(page.getByText(/Zatím tu nikdo není/)).toBeVisible();
    expect(await guestRows(site.weddingId)).toHaveLength(0);
  });

  test("hledání a filtr podle odpovědi, hromadné pozvání na událost", async ({ page, context }) => {
    const site = await seedSite();
    await site.login(context);
    await seedHouseholds(site.weddingId, [
      { label: "Novákovi", guests: [{ name: "Jan Novák" }, { name: "Eva Nováková" }], events: [] },
      { label: "Černí", guests: [{ name: "Karel Černý" }], events: [] },
    ]);
    await page.goto(appUrl("/hoste"));
    await expect(page.getByTestId("guest-count")).toHaveText("Domácností: 2, hostů: 3");

    await page.getByLabel("Hledat hosta nebo domácnost").fill("novak");
    await expect(page.getByText("Zobrazeno domácností: 1")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Novákovi" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Černí" })).toHaveCount(0);
    await page.getByLabel("Hledat hosta nebo domácnost").fill("");
    await page.getByLabel("Odpověď", { exact: true }).selectOption("attending");
    await expect(page.getByText("Zobrazeno domácností: 0")).toBeVisible();
    await page.getByLabel("Odpověď", { exact: true }).selectOption("all");
    await expect(page.getByText("Zobrazeno domácností: 2")).toBeVisible();

    // nikdo není pozván; hromadné pozvání pozve všechny na obřad
    await expect(page.getByText("nepozván(a) na žádnou událost").first()).toBeVisible();
    await page
      .getByRole("button", { name: "Pozvat všechny hosty na událost Svatební obřad" })
      .click();
    await expect(
      page.getByText(/Pozvat\svšechny\shosty\s\(počet:\s3\)\sna\sudálost/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ano, provést" }).click();
    await expect(page.getByTestId("guest-count")).toBeVisible();
    await expect(page.getByText("pozván(a): Svatební obřad").first()).toBeVisible();
    expect((await guestRows(site.weddingId)).map((g) => g.invitations)).toEqual([1, 1, 1]);
  });
});

test.describe("skupiny hostů", () => {
  test("skupiny v editoru, filtr s počty a pozvání jen skupiny", async ({ page, context }) => {
    const site = await seedSite();
    await site.login(context);
    await seedHouseholds(site.weddingId, [
      {
        label: "Novákovi",
        tags: ["Kolegové"],
        guests: [{ name: "Jan Novák" }, { name: "Eva Nováková" }],
        events: ["ceremony"],
      },
      { label: "Černí", guests: [{ name: "Karel Černý" }], events: ["ceremony"] },
    ]);
    await page.goto(appUrl("/hoste"));

    // nová domácnost: skupinu zapíšu a druhou přidám z nabídky už používaných
    await page.getByRole("link", { name: "Přidat domácnost" }).click();
    await page.getByLabel("Název domácnosti").fill("Dvořákovi");
    await page.getByLabel("Skupiny", { exact: true }).fill("Rodina nevěsty");
    await page.getByRole("button", { name: "Přidat skupinu Kolegové" }).click();
    await expect(page.getByLabel("Skupiny", { exact: true })).toHaveValue(
      "Rodina nevěsty, Kolegové",
    );
    await expect(page.getByRole("button", { name: "Přidat skupinu Kolegové" })).toHaveCount(0);
    await page.getByLabel("Jméno a příjmení").fill("Karel Dvořák");
    await page.getByRole("button", { name: "Uložit domácnost" }).click();
    await waitSaved(page);
    const dvorak = page.getByRole("article", { name: "Dvořákovi" });
    await expect(dvorak.getByRole("list", { name: "Skupiny" })).toHaveText(
      /Rodina nevěsty\s*Kolegové/,
    );
    expect((await guestRows(site.weddingId)).find((g) => g.label === "Dvořákovi")?.tags).toEqual([
      "Rodina nevěsty",
      "Kolegové",
    ]);

    // příliš dlouhá skupina: chyba u pole, nic se neuloží
    await page.getByRole("link", { name: "Upravit domácnost Černí" }).click();
    await page.getByLabel("Skupiny", { exact: true }).fill("x".repeat(41));
    await page.getByRole("button", { name: "Uložit domácnost" }).click();
    await expect(
      page.getByText("Skupin může být nejvýš 10 a každá nejvýš 40 znaků."),
    ).toBeVisible();
    await expect(page.getByLabel("Skupiny", { exact: true })).toBeFocused();
    await page.getByRole("link", { name: "Zpět na seznam" }).click();

    // filtr podle skupiny s počty
    await page.getByLabel("Skupina", { exact: true }).selectOption("Kolegové");
    await expect(page.getByText("Zobrazeno domácností: 2")).toBeVisible();
    await expect(page.getByTestId("group-stats")).toHaveText(
      norm("Domácností: 2, hostů: 3. Přijde: 0, nepřijde: 0, neodpověděli: 3."),
    );
    await expect(page.getByRole("heading", { level: 2, name: "Černí" })).toHaveCount(0);
    await page.getByLabel("Skupina", { exact: true }).selectOption({ label: "Bez skupiny" });
    await expect(page.getByText("Zobrazeno domácností: 1")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Černí" })).toBeVisible();

    // pozvání jen skupiny na hostinu (program podle skupiny), ostatní beze změny
    await page.getByLabel("Skupina", { exact: true }).selectOption("Kolegové");
    await page.getByRole("button", { name: "Pozvat skupinu Kolegové na událost Hostina" }).click();
    await expect(
      page.getByText(/Pozvat skupinu Kolegové \(hostů: 3\) na událost Hostina/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ano, provést" }).click();
    await waitSaved(page);
    // Dvořákovi (nová domácnost z editoru) jsou pozvaní na obě události už od založení
    const invitations = Object.fromEntries(
      (await guestRows(site.weddingId)).map((g) => [g.display_name, g.invitations]),
    );
    expect(invitations).toEqual({
      "Eva Nováková": 2,
      "Jan Novák": 2,
      "Karel Černý": 1,
      "Karel Dvořák": 2,
    });
  });
});

test.describe("import hostů", () => {
  test("CSV: náhled s chybou a duplicitami, import po potvrzení s pozváním na události", async ({
    page,
    context,
  }) => {
    const site = await seedSite();
    await site.login(context);
    await seedHouseholds(site.weddingId, [
      { label: "Novákovi", guests: [{ name: "Jan Novák" }], events: [] },
    ]);
    await page.goto(appUrl("/hoste/import"));
    await expect(page.getByRole("heading", { level: 1, name: "Import hostů" })).toBeVisible();

    // bez souboru: chyba slovy
    await page.getByRole("button", { name: "Zobrazit náhled" }).click();
    await expect(page.getByText("Vyberte soubor, který chcete nahrát.")).toBeVisible();

    await page.getByLabel("Soubor se seznamem hostů").setInputFiles({
      name: "hoste.csv",
      mimeType: "text/csv",
      buffer: csv(
        [
          "Domácnost;Jméno a příjmení;Dítě;Věk",
          "Svobodovi;Marie Svobodová;ne;",
          "Svobodovi;Tomáš Svoboda;ano;6",
          ";Novák Jan;ne;",
          ";Petr Dvořák;možná;",
          ";Petr Dvořák;ne;",
        ].join("\r\n"),
      ),
    });
    await page.getByRole("button", { name: "Zobrazit náhled" }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: "2. Zkontrolujte náhled" }),
    ).toBeFocused();
    await expect(page.getByTestId("import-summary")).toHaveText(
      "Řádků v souboru: 5. K importu: 3. S chybou: 1. Duplicit: 1.",
    );
    const table = page.getByRole("table", { name: "Náhled importovaných řádků" });
    await expect(
      table.getByRole("row", { name: /Novák Jan.*Už je v seznamu – přeskočí se/ }),
    ).toBeVisible();
    await expect(
      table.getByRole("row", { name: /Ve sloupci Dítě má být ano nebo ne/ }),
    ).toBeVisible();
    await expect(
      table.getByRole("row", { name: /Tomáš Svoboda.*dítě, 6 let.*Připraveno/ }),
    ).toBeVisible();

    // volba o duplicitách přepočítá počet
    await page.getByLabel("Importovat i duplicity", { exact: false }).check();
    await expect(page.getByRole("button", { name: "Importovat hostů: 4" })).toBeVisible();
    await page.getByLabel("Importovat i duplicity", { exact: false }).uncheck();
    await page.getByLabel("Hostina").uncheck();
    await page.getByRole("button", { name: "Importovat hostů: 3" }).click();
    await expect(page.getByTestId("import-result")).toHaveText(
      "Naimportováno hostů: 3, domácností: 2.",
    );

    const rows = await guestRows(site.weddingId);
    expect(rows.map((g) => [g.display_name, g.source, g.label, g.invitations])).toEqual([
      ["Jan Novák", "manual", "Novákovi", 0],
      ["Marie Svobodová", "import", "Svobodovi", 1],
      ["Petr Dvořák", "import", "", 1],
      ["Tomáš Svoboda", "import", "Svobodovi", 1],
    ]);
    expect(rows.find((g) => g.display_name === "Tomáš Svoboda")).toMatchObject({
      is_child: true,
      age: 6,
    });
    expect(
      await auditRows("wedding_id = $1 and action = 'guests.import'", [site.weddingId]),
    ).toHaveLength(1);

    await page.getByRole("link", { name: "Zpět na seznam hostů" }).click();
    await expect(page.getByTestId("guest-count")).toHaveText("Domácností: 3, hostů: 4");
  });

  test("Excel (.xlsx) a vzorové tabulky ke stažení", async ({ page, context }) => {
    const site = await seedSite();
    await site.login(context);
    await page.goto(appUrl("/hoste/import"));

    const xlsx = await toXlsx({
      name: "Hosté",
      headers: ["Jméno", "Příjmení", "Domácnost"],
      rows: [
        ["Eva", "Nová", "Novovi"],
        ["Pavel", "Nový", "Novovi"],
      ],
    });
    await page.getByLabel("Soubor se seznamem hostů").setInputFiles({
      name: "hoste.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx,
    });
    await page.getByRole("button", { name: "Zobrazit náhled" }).click();
    await expect(page.getByTestId("import-summary")).toHaveText(
      "Řádků v souboru: 2. K importu: 2. S chybou: 0. Duplicit: 0.",
    );
    await page.getByRole("button", { name: "Importovat hostů: 2" }).click();
    await expect(page.getByTestId("import-result")).toHaveText(
      "Naimportováno hostů: 2, domácností: 1.",
    );
    expect((await guestRows(site.weddingId)).map((g) => g.display_name)).toEqual([
      "Eva Nová",
      "Pavel Nový",
    ]);

    // vzor ke stažení jde zase naimportovat
    await page.goto(appUrl("/hoste/import"));
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Stáhnout vzor v CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("vzor-hoste.csv");
    const template = readFileSync((await download.path())!);
    expect(template.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    await page.getByLabel("Soubor se seznamem hostů").setInputFiles({
      name: "vzor.csv",
      mimeType: "text/csv",
      buffer: template,
    });
    await page.getByRole("button", { name: "Zobrazit náhled" }).click();
    await expect(page.getByTestId("import-summary")).toHaveText(
      "Řádků v souboru: 4. K importu: 4. S chybou: 0. Duplicit: 0.",
    );
  });

  test("nepřijatelné soubory: starý .xls, příliš velký, bez záhlaví se jménem, příliš mnoho řádků", async ({
    page,
    context,
  }) => {
    const site = await seedSite();
    await site.login(context);
    await page.goto(appUrl("/hoste/import"));
    const file = page.getByLabel("Soubor se seznamem hostů");
    const submit = page.getByRole("button", { name: "Zobrazit náhled" });
    const alert = (text: string | RegExp) => page.getByRole("alert").filter({ hasText: text });

    await file.setInputFiles({
      name: "stary.xls",
      mimeType: "application/vnd.ms-excel",
      buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]),
    });
    await submit.click();
    await expect(alert("Tenhle formát neumíme přečíst")).toBeVisible();

    await file.setInputFiles({
      name: "velky.csv",
      mimeType: "text/csv",
      buffer: Buffer.alloc(1024 * 1024 + 10, "a"),
    });
    await submit.click();
    await expect(alert("Soubor je příliš velký")).toBeVisible();

    await file.setInputFiles({
      name: "bez-jmena.csv",
      mimeType: "text/csv",
      buffer: csv("Telefon;Město\n123;Praha"),
    });
    await submit.click();
    await expect(alert("Nenašli jsme sloupec se jménem")).toBeVisible();

    const many = ["Jméno", ...Array.from({ length: 1001 }, (_, i) => `Host ${i}`)].join("\n");
    await file.setInputFiles({ name: "mnoho.csv", mimeType: "text/csv", buffer: csv(many) });
    await submit.click();
    await expect(alert("příliš mnoho řádků")).toBeVisible();
    expect(await guestRows(site.weddingId)).toHaveLength(0);
  });
});

test.describe("export hostů", () => {
  test("Excel a CSV, dieta jen na výslovnou volbu", async ({ page, context }) => {
    const site = await seedSite();
    await site.login(context);
    await seedHouseholds(site.weddingId, [
      { label: "Novákovi", guests: [{ name: "Jan Novák" }, { name: "=Eva Nováková" }] },
    ]);
    await page.goto(appUrl("/hoste"));

    const download = async (): Promise<{ name: string; body: Buffer }> => {
      const [file] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Stáhnout export" }).click(),
      ]);
      return { name: file.suggestedFilename(), body: readFileSync((await file.path())!) };
    };

    await page.getByLabel("CSV (středník, UTF-8)").check();
    const plain = await download();
    expect(plain.name).toMatch(/^hoste-a-rsvp-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = plain.body.toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("Domácnost;Jméno;Typ");
    expect(text).toContain("Jan Novák");
    // buňka začínající = se neutralizuje (CSV injection)
    expect(text).toContain("'=Eva Nováková");
    expect(text).not.toContain("Dieta");

    await page.getByLabel("Včetně diety a alergií").check();
    const withHealth = await download();
    expect(withHealth.body.toString("utf8")).toContain("Dieta;Alergie");

    await page.getByLabel("Excel (.xlsx)").check();
    await page.getByLabel("Včetně diety a alergií").uncheck();
    const excel = await download();
    expect(excel.name).toMatch(/\.xlsx$/);
    expect(excel.body.subarray(0, 2).toString()).toBe("PK");

    const audit = await auditRows("wedding_id = $1 and action = 'export.guests'", [site.weddingId]);
    expect(audit).toHaveLength(3);
    expect(JSON.stringify(audit)).not.toContain("Novák");
  });
});

test.describe("přehled odpovědí a ruční zápis", () => {
  test("host odpověděl telefonem: chyby slovy se zachováním zadaného, zápis, přehled a počty", async ({
    page,
    context,
  }) => {
    const site = await seedSite();
    await site.login(context);
    const [household] = await seedHouseholds(site.weddingId, [
      { label: "Svobodovi", guests: [{ name: "Petr Svoboda" }, { name: "Eva Svobodová" }] },
      { label: "Černí", guests: [{ name: "Karel Černý" }] },
    ]);
    await page.goto(appUrl("/odpovedi"));
    await expect(page.getByRole("heading", { level: 1, name: "Odpovědi" })).toBeVisible();
    await expect(page.getByTestId("households-total")).toHaveText("Odpovědělo domácností: 0 z 2");
    await expect(page.getByRole("heading", { level: 2, name: "Neodpověděli (2)" })).toBeVisible();

    await page.getByRole("link", { name: "Zapsat odpověď domácnosti Svobodovi" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Zápis odpovědi" })).toBeVisible();

    // jen první skupina vyplněna: ostatní chyby slovy, vyplněné zůstane (3.3.7)
    const petr = page.getByRole("region", { name: "Petr Svoboda" });
    await petr
      .getByRole("group", { name: "Přijde: Svatební obřad" })
      .getByLabel("ano", { exact: true })
      .check();
    await page.getByRole("button", { name: "Uložit odpověď" }).click();
    await expect(page.getByText("Opravte prosím označená pole.")).toBeVisible();
    await expect(petr.getByText("Vyberte jednu možnost.").first()).toBeVisible();
    await expect(
      petr
        .getByRole("group", { name: "Přijde: Svatební obřad" })
        .getByLabel("ano", { exact: true }),
    ).toBeChecked();
    expect(await responseRows(site.weddingId)).toHaveLength(0);

    await petr
      .getByRole("group", { name: "Přijde: Hostina" })
      .getByLabel("ne", { exact: true })
      .check();
    const eva = page.getByRole("region", { name: "Eva Svobodová" });
    await eva
      .getByRole("group", { name: "Přijde: Svatební obřad" })
      .getByLabel("ano", { exact: true })
      .check();
    await eva
      .getByRole("group", { name: "Přijde: Hostina" })
      .getByLabel("ano", { exact: true })
      .check();
    await page.getByRole("button", { name: "Uložit odpověď" }).click();
    await expect(page.getByTestId("entry-saved")).toHaveText("Odpověď je uložená.");

    const saved = await responseRows(site.weddingId);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ entered_by: "admin", attending: 3, declined: 1 });
    expect(
      await auditRows("wedding_id = $1 and action like 'rsvp.%'", [site.weddingId]),
    ).not.toEqual(expect.arrayContaining([expect.objectContaining({ actor_type: "guest" })]));

    await page.getByRole("link", { name: "Zpět na přehled odpovědí" }).click();
    await expect(page.getByTestId("households-total")).toHaveText("Odpovědělo domácností: 1 z 2");
    await expect(
      page.getByRole("heading", { level: 2, name: "Odpověděli (1)", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Neodpověděli (1)", exact: true }),
    ).toBeVisible();
    const totals = page.getByTestId("event-totals");
    await expect(totals.getByRole("row", { name: /Svatební obřad\s+3\s+2\s+0\s+1/ })).toBeVisible();
    await expect(totals.getByRole("row", { name: /Hostina\s+3\s+1\s+1\s+1/ })).toBeVisible();
    await expect(page.getByText(/zapsal správce/)).toBeVisible();

    // úprava dřívější odpovědi: formulář je předvyplněný
    await page.goto(appUrl(`/odpovedi/${household}`));
    await expect(
      page
        .getByRole("region", { name: "Petr Svoboda" })
        .getByRole("group", { name: "Přijde: Hostina" })
        .getByLabel("ne", { exact: true }),
    ).toBeChecked();
  });

  test("doprovod, dítě a dieta při zapnutých otázkách; povinná vlastní otázka správce nezdrží", async ({
    page,
    context,
  }) => {
    const site = await seedSite();
    await site.login(context);
    await withDb(async (db) => {
      await db.query(
        "update se_vezmou.rsvp_settings set enabled_questions = $2 where wedding_id = $1",
        [
          site.weddingId,
          JSON.stringify({ plus_one: true, children: true, diet: true, song: true }),
        ],
      );
      await db.query(
        `insert into se_vezmou.rsvp_questions (wedding_id, key, type, label, required, position)
         values ($1, 'autobus', 'bool', '{"cs": "Pojedete autobusem?"}', true, 1)`,
        [site.weddingId],
      );
    });
    const [household] = await seedHouseholds(site.weddingId, [
      { label: "Novákovi", guests: [{ name: "Jan Novák" }], events: ["ceremony"] },
    ]);
    await page.goto(appUrl(`/odpovedi/${household}`));
    await expect(page.getByRole("heading", { level: 1, name: "Zápis odpovědi" })).toBeVisible();

    const jan = page.getByRole("region", { name: "Jan Novák" });
    await jan
      .getByRole("group", { name: "Přijde: Svatební obřad" })
      .getByLabel("ano", { exact: true })
      .check();
    await jan.getByLabel("Dieta").fill("vegetariánská");
    await page.getByRole("button", { name: "Přidat doprovod" }).click();
    const plusOne = page.getByRole("region", { name: "Doprovod" });
    await plusOne.getByLabel("Jméno a příjmení").fill("Hana Nováková");
    await plusOne
      .getByRole("group", { name: "Přijde: Svatební obřad" })
      .getByLabel("ne", { exact: true })
      .check();
    await expect(page.getByRole("button", { name: "Přidat doprovod" })).toHaveCount(0);
    await page.getByRole("button", { name: "Přidat dítě" }).click();
    const child = page.getByRole("region", { name: "Dítě doplněné navíc" });
    await child.getByLabel("Jméno a příjmení").fill("Pepík");
    await child.getByLabel("Věk dítěte").fill("17");
    await child
      .getByRole("group", { name: "Přijde: Svatební obřad" })
      .getByLabel("ano", { exact: true })
      .check();
    await page.getByLabel("Přání písničky").fill("Tichá noc");
    await page.getByRole("button", { name: "Uložit odpověď" }).click();
    await expect(page.getByTestId("entry-saved")).toBeVisible();

    const saved = await withDb(async (db) => {
      const result = await db.query<{
        answers: Record<string, unknown>;
        people: number;
        diet: string | null;
      }>(
        `select r.answers, (select count(*)::int from se_vezmou.rsvp_people p where p.response_id = r.id) as people,
                (select h.diet from se_vezmou.rsvp_health h join se_vezmou.rsvp_people p on p.id = h.person_id
                  where p.response_id = r.id limit 1) as diet
           from se_vezmou.rsvp_responses r where r.wedding_id = $1`,
        [site.weddingId],
      );
      return result.rows[0];
    });
    expect(saved).toMatchObject({ people: 3, diet: "vegetariánská" });
    expect(saved.answers).toMatchObject({ song: "Tichá noc" });

    // věk dítěte nad 17 se nevezme
    await child.getByLabel("Věk dítěte").fill("18");
    await page.getByRole("button", { name: "Uložit odpověď" }).click();
    await expect(child.getByText("Věk dítěte zadejte jako celé číslo od 0 do 17.")).toBeVisible();
    await expect(child.getByLabel("Věk dítěte")).toBeFocused();
  });
});

test.describe("nastavení RSVP", () => {
  test("otevření a uzavření, vlastní otázka s výběrem, host mimo seznam, potvrzení e-mailem", async ({
    page,
    context,
  }) => {
    const site = await seedSite();
    await site.login(context);
    await page.goto(appUrl("/odpovedi/nastaveni"));
    await expect(page.getByRole("heading", { level: 1, name: "Nastavení odpovědí" })).toBeVisible();
    await expect(page.getByTestId("rsvp-window")).toHaveText("Odpovídat jde teď.");

    await page.getByLabel("Povolit odpověď i hostům, které nemáme v seznamu").check();
    await page.getByLabel("Nabídnout hostům potvrzení e-mailem").check();
    await page.getByLabel("Dieta a alergie").check();
    await page.getByLabel("Přání písničky").check();

    // jen datum bez času: chyba slovy
    const closes = page.getByRole("group", { name: "Uzavřít po" });
    await closes.getByLabel("Datum").fill("2027-06-01");
    await page.getByRole("button", { name: "Uložit nastavení" }).click();
    await expect(page.getByText("Vyplňte datum i čas, nebo obojí nechte prázdné.")).toBeVisible();
    await closes.getByLabel("Čas").fill("23:00");

    // vlastní otázka
    await page.getByRole("button", { name: "Přidat otázku" }).click();
    const question = page.getByRole("group", { name: "Otázka 1" });
    await question
      .getByRole("group", { name: "Text otázky" })
      .getByLabel("Čeština")
      .fill("Jaké menu?");
    await question.getByLabel("Druh odpovědi").selectOption("choice");
    await page.getByRole("button", { name: "Uložit nastavení" }).click();
    await expect(
      page.getByText("Každá možnost potřebuje text aspoň v jednom jazyce."),
    ).toBeVisible();
    await question.getByRole("group", { name: "Možnost 1" }).getByLabel("Čeština").fill("Maso");
    await question.getByRole("group", { name: "Možnost 2" }).getByLabel("Čeština").fill("Ryba");
    await question.getByLabel("Ptát se jen na události").selectOption({ label: "Hostina" });
    await question.getByLabel("Povinná otázka").check();
    await page.getByRole("button", { name: "Uložit nastavení" }).click();
    await expect(page.getByText("Nastavení je uložené.")).toBeVisible();

    const saved = await rsvpSettingsRow(site.weddingId);
    expect(saved.settings).toMatchObject({ allow_unlisted: true, email_confirmation: true });
    expect(saved.settings.enabled_questions).toMatchObject({
      diet: true,
      song: true,
      lodging: false,
    });
    expect(saved.settings.closes_at?.toISOString()).toBe("2027-06-01T21:00:00.000Z");
    expect(saved.questions).toEqual([
      expect.objectContaining({ type: "choice", required: true, enabled: true }),
    ]);
    expect(saved.questions[0].key).toMatch(/^q[a-z0-9]{1,19}$/);

    // uzavření hned: stav slovy, po uložení i v přehledu odpovědí
    await page.getByRole("button", { name: "Uzavřít hned" }).click();
    await expect(page.getByTestId("rsvp-window")).toHaveText("Odpovídání je uzavřené.");
    await page.getByRole("button", { name: "Uložit nastavení" }).click();
    await expect(page.getByText("Nastavení je uložené.")).toBeVisible();
    await page.goto(appUrl("/odpovedi"));
    await expect(page.getByTestId("rsvp-window")).toHaveText("Odpovídání je uzavřené.");

    // otevřít hned, otázku odebrat
    await page.goto(appUrl("/odpovedi/nastaveni"));
    await page.getByRole("button", { name: "Otevřít hned" }).click();
    await page.getByRole("button", { name: "Odebrat otázku 1" }).click();
    await page.getByRole("button", { name: "Uložit nastavení" }).click();
    await expect(page.getByText("Nastavení je uložené.")).toBeVisible();
    const reopened = await rsvpSettingsRow(site.weddingId);
    expect(reopened.settings.closes_at).toBeNull();
    expect(reopened.questions).toHaveLength(0);
  });

  test("uzavření před otevřením se odmítne", async ({ page, context }) => {
    const site = await seedSite();
    await site.login(context);
    await page.goto(appUrl("/odpovedi/nastaveni"));
    const opens = page.getByRole("group", { name: "Otevřít od" });
    const closes = page.getByRole("group", { name: "Uzavřít po" });
    await opens.getByLabel("Datum").fill("2027-06-10");
    await opens.getByLabel("Čas").fill("10:00");
    await closes.getByLabel("Datum").fill("2027-06-01");
    await closes.getByLabel("Čas").fill("10:00");
    await page.getByRole("button", { name: "Uložit nastavení" }).click();
    await expect(page.getByText("Uzavření musí být později než otevření.")).toBeVisible();
    expect((await rsvpSettingsRow(site.weddingId)).settings.opens_at).toBeNull();
  });
});

test.describe("správci a záložní e-mail", () => {
  test("přidání se potvrzuje, oznámení dostanou ostatní správci i záložní adresa, strop počtu", async ({
    page,
    context,
  }) => {
    const site = await seedSite();
    await site.login(context);
    const backup = await backupEmail(site.weddingId);
    const second = `druhy-${site.tag}@example.test`;
    const third = `treti-${site.tag}@example.test`;
    await page.goto(appUrl("/pristup"));
    await expect(page.getByRole("heading", { level: 1, name: "Přístup" })).toBeVisible();
    await expect(page.getByTestId("admins-count")).toHaveText("Správců: 1 z nejvýš 3");

    const email = page.getByLabel("E-mail nového správce");
    await email.fill("bez-zavinace");
    await page.getByRole("button", { name: "Přidat správce", exact: true }).click();
    await expect(page.getByText("Zadejte platný e-mail, například eva@example.cz.")).toBeVisible();

    await email.fill(second.toUpperCase());
    await page.getByRole("button", { name: "Přidat správce", exact: true }).click();
    await expect(
      page.getByRole("group", { name: new RegExp(`Přidat\\ssprávce\\s${second}`, "i") }),
    ).toBeVisible();
    // před potvrzením se nic nestalo
    expect(await activeAdminEmails(site.weddingId)).toHaveLength(1);
    await page.getByRole("button", { name: "Ano, přidat" }).click();
    await expect(page.getByText(/Změna\sje\suložená\sa\sostatním\ssprávcům/)).toBeVisible();
    await expect(page.getByTestId("admins-count")).toHaveText("Správců: 2 z nejvýš 3");
    expect(await activeAdminEmails(site.weddingId)).toEqual([site.adminEmail, second]);

    // oznámení: novému správci, původnímu správci a záložní adrese
    expect(await subject(second)).toBe("Byli jste přidáni do správy svatebního webu");
    expect(await subject(site.adminEmail)).toBe(
      "Do správy vašeho svatebního webu byl přidán další správce",
    );
    expect(await subject(backup)).toBe("Do správy vašeho svatebního webu byl přidán další správce");
    expect(readMails(second)).toHaveLength(1);

    // duplicita
    await page.getByLabel("E-mail nového správce").fill(second);
    await page.getByRole("button", { name: "Přidat správce", exact: true }).click();
    await page.getByRole("button", { name: "Ano, přidat" }).click();
    await expect(page.getByText("Tenhle e-mail už je mezi správci.")).toBeVisible();

    // třetí správce a strop
    await page.getByLabel("E-mail nového správce").fill(third);
    await page.getByRole("button", { name: "Přidat správce", exact: true }).click();
    await page.getByRole("button", { name: "Ano, přidat" }).click();
    await expect(page.getByTestId("admins-count")).toHaveText("Správců: 3 z nejvýš 3");
    await expect(page.getByLabel("E-mail nového správce")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Přidat správce", exact: true })).toBeDisabled();
    await expect(page.getByText(/Dosáhli jste nejvyššího počtu správců/).first()).toBeVisible();

    // sám sebe odebrat nejde (u mého řádku není tlačítko)
    await expect(
      page.getByRole("button", { name: `Odebrat správce ${site.adminEmail}` }),
    ).toHaveCount(0);
  });

  test("odebrání správce ukončí jeho přihlášení a oznámí se", async ({
    page,
    context,
    browser,
  }) => {
    const site = await seedSite();
    await site.login(context);
    const second = `druhy-${site.tag}@example.test`;
    const secondId = await withDb(async (db) => {
      const result = await db.query<{ id: string }>(
        "insert into se_vezmou.wedding_admins (wedding_id, email, added_by) values ($1, $2, $3) returning id",
        [site.weddingId, second, site.adminId],
      );
      return result.rows[0].id;
    });
    const other = await browser.newContext();
    await loginAs(other, site.weddingId, secondId);
    const otherPage = await other.newPage();
    await otherPage.goto(appUrl("/pristup"));
    await expect(otherPage.getByRole("heading", { level: 1, name: "Přístup" })).toBeVisible();

    await page.goto(appUrl("/pristup"));
    await page.getByRole("button", { name: `Odebrat správce ${second}` }).click();
    await expect(page.getByText(/Hned se mu ukončí všechna přihlášení/)).toBeVisible();
    await page.getByRole("button", { name: "Ano, odebrat" }).click();
    await expect(page.getByTestId("admins-count")).toHaveText("Správců: 1 z nejvýš 3");
    expect(await activeAdminEmails(site.weddingId)).toEqual([site.adminEmail]);
    expect(await sessionState(site.weddingId, secondId)).toEqual([{ revoked: true }]);

    expect(await subject(second)).toBe("Váš přístup ke správě svatebního webu skončil");
    expect(await subject(site.adminEmail)).toBe(
      "Ze správy vašeho svatebního webu byl odebrán správce",
    );

    // odebraný správce se do správy už nedostane
    await otherPage.goto(appUrl("/pristup"));
    await expect(otherPage).toHaveURL(/\/prihlaseni/);
    await other.close();
  });

  test("změna záložního e-mailu se potvrzuje a oznámí staré i nové adrese i správcům", async ({
    page,
    context,
  }) => {
    const site = await seedSite();
    await site.login(context);
    const old = await backupEmail(site.weddingId);
    const next = `nova-zaloha-${site.tag}@example.test`;
    await page.goto(appUrl("/pristup"));
    await expect(page.getByTestId("backup-email")).toHaveText(`Záložní e-mail: ${old}`);

    await page.getByLabel("Nový záložní e-mail").fill(next);
    await page.getByRole("button", { name: "Změnit záložní e-mail" }).click();
    await expect(page.getByText(/Stará\si\snová\sadresa\sa\sspráv/)).toBeVisible();
    expect(await backupEmail(site.weddingId)).toBe(old);
    await page.getByRole("button", { name: "Ano, změnit" }).click();
    await expect(page.getByTestId("backup-email")).toHaveText(`Záložní e-mail: ${next}`);
    expect(await backupEmail(site.weddingId)).toBe(next);

    expect(await subject(old)).toBe("Tato adresa už není záložní e-mail svatebního webu");
    // nová adresa je nepotvrzená: dostane jedinou neutrální zprávu, ne oznámení o změně
    expect(await subject(next)).toBe("Někdo vás uvedl jako záložní e-mail svatebního webu");
    expect(await subject(site.adminEmail)).toBe("Záložní e-mail vašeho svatebního webu se změnil");
  });
});

test.describe("PIN a PDF oznámení", () => {
  test("PIN správy a hostů: kontroly slovy, uložení, oznámení na záložní e-mail, zapnutí a vypnutí PINu hostů", async ({
    page,
    context,
  }) => {
    const site = await seedSite({ guestPin: GUEST_PIN });
    await site.login(context);
    const backup = await backupEmail(site.weddingId);
    await page.goto(appUrl("/pristup"));
    const adminForm = page.locator("form").filter({
      has: page.getByRole("heading", { level: 3, name: "PIN správy" }),
    });
    const guestForm = page.locator("form").filter({
      has: page.getByRole("heading", { level: 3, name: "PIN hostů" }),
    });
    await expect(adminForm.getByText("PIN zatím není nastavený.")).toBeVisible();
    await expect(guestForm.getByText("PIN je nastavený.")).toBeVisible();

    await adminForm.getByLabel("Nový PIN").fill("111111");
    await adminForm.getByRole("button", { name: "Nastavit PIN" }).click();
    await expect(adminForm.getByText(/Tenhle PIN je příliš snadný/)).toBeVisible();
    await adminForm.getByLabel("Nový PIN").fill("12ab");
    await adminForm.getByRole("button", { name: "Nastavit PIN" }).click();
    await expect(adminForm.getByText(/PIN musí mít šest až osm číslic/)).toBeVisible();
    await adminForm.getByLabel("Nový PIN").fill(GUEST_PIN);
    await adminForm.getByRole("button", { name: "Nastavit PIN" }).click();
    await expect(adminForm.getByText("PIN správy a PIN hostů musí být různé.")).toBeVisible();
    expect((await guestPinState(site.weddingId)).has_admin_pin).toBe(false);

    await adminForm.getByLabel("Nový PIN").fill("739104");
    await adminForm.getByRole("button", { name: "Nastavit PIN" }).click();
    await expect(adminForm.getByText(/PIN je uložený/)).toBeVisible();
    expect((await guestPinState(site.weddingId)).has_admin_pin).toBe(true);
    expect(await subject(backup)).toBe("Změna PINu u vašeho svatebního webu");
    expect(
      await auditRows("wedding_id = $1 and action = 'pin.change'", [site.weddingId]),
    ).toHaveLength(1);

    // vypnutí a zapnutí PINu hostů
    await expect(page.getByTestId("guest-pin-state")).toHaveText("PIN hostů je zapnutý.");
    await page.getByRole("button", { name: "Vypnout PIN hostů" }).click();
    await page.getByRole("button", { name: "Ano, vypnout" }).click();
    await expect(page.getByTestId("guest-pin-state")).toHaveText("PIN hostů je vypnutý.");
    expect((await guestPinState(site.weddingId)).enabled).toBe(false);
    await page.getByRole("button", { name: "Zapnout PIN hostů" }).click();
    await expect(page.getByTestId("guest-pin-state")).toHaveText("PIN hostů je zapnutý.");
    expect((await guestPinState(site.weddingId)).enabled).toBe(true);
  });

  test("PDF oznámení se dá vytisknout znovu", async ({ page, context }) => {
    const site = await seedSite({ guestPin: GUEST_PIN });
    await site.login(context);
    await page.goto(appUrl("/pristup"));
    await page.getByLabel("PIN hostů", { exact: true }).fill(GUEST_PIN);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Stáhnout PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`oznameni-${site.slug}.pdf`);
    expect(
      readFileSync((await download.path())!)
        .subarray(0, 4)
        .toString(),
    ).toBe("%PDF");
  });
});

test.describe("souhlas s nahlédnutím provozovatele", () => {
  test("udělení s důvodem, nahlédnutí provozovatele se oznámí a eviduje, odvolání zavře přístup", async ({
    page,
    context,
  }) => {
    const site = await seedSite();
    await site.login(context);
    const backup = await backupEmail(site.weddingId);
    await seedHouseholds(site.weddingId, [
      { label: "Novákovi", guests: [{ name: `Jan Novák ${site.tag}` }] },
    ]);
    await page.goto(appUrl("/pristup"));
    await expect(page.getByText(/Nemáte udělený žádný souhlas/)).toBeVisible();
    await expect(page.getByText(/nenahlédl/)).toBeVisible();

    // bez důvodu nic
    await page.getByRole("button", { name: "Udělit souhlas" }).click();
    await expect(page.getByText("Napište stručně důvod, aspoň pár slov.")).toBeVisible();
    expect(await grantRows(site.weddingId)).toHaveLength(0);

    await page.getByLabel("Důvod", { exact: true }).fill("Nejde mi import seznamu");
    await page.getByLabel("Platnost souhlasu").selectOption("3");
    await page.getByRole("button", { name: "Udělit souhlas" }).click();
    await expect(
      page.getByText(/Povolit\sprovozovateli\snahlédnout\sdo\súdajů\shostů\sna\s3\sdní/),
    ).toBeVisible();
    expect(await grantRows(site.weddingId)).toHaveLength(0);
    await page.getByRole("button", { name: "Ano, povolit" }).click();
    await expect(page.getByTestId("consent-state")).toContainText("Souhlas platí do");
    await expect(page.getByTestId("consent-state")).toContainText("Důvod: Nejde mi import seznamu");
    expect(await grantRows(site.weddingId)).toEqual([
      expect.objectContaining({ reason: "Nejde mi import seznamu", active: true }),
    ]);
    expect(await subject(site.adminEmail)).toBe(
      "Udělen souhlas s nahlédnutím provozovatele do údajů hostů",
    );
    expect(await subject(backup)).toBe("Udělen souhlas s nahlédnutím provozovatele do údajů hostů");

    // provozovatel nahlédne: pár dostane e-mail s důvodem a přehled to eviduje
    const operator = await seedOperator({ role: "support", enrolled: true });
    await loginAsOperator(page, operator);
    await page.goto(admin(`/zakazky/${site.weddingId}`));
    const guests = page.getByRole("region", { name: "Údaje hostů" });
    await guests.getByLabel("Důvod nahlédnutí").fill("Řešení potíží s importem");
    await guests.getByRole("button", { name: "Zobrazit údaje hostů" }).click();
    await expect(guests.getByRole("rowheader", { name: `Jan Novák ${site.tag}` })).toBeVisible();

    const viewed = await waitForMail(site.adminEmail, 2);
    expect(norm(viewed.subject)).toBe("Provozovatel nahlédl do údajů vašich hostů");
    expect(norm(viewed.text)).toContain("Řešení potíží s importem");
    expect(viewed.text).not.toContain(`Jan Novák ${site.tag}`);
    expect(await subject(backup, 2)).toBe("Provozovatel nahlédl do údajů vašich hostů");

    await page.goto(appUrl("/pristup"));
    const views = page.getByTestId("operator-views");
    await expect(views).toContainText("provozovatel nahlédl do údajů hostů");
    await expect(views).toContainText("důvod: Řešení potíží s importem");

    // odvolání: přístup se zavře a pár o tom dostane e-mail
    await page.getByRole("button", { name: "Odvolat souhlas" }).click();
    await page.getByRole("button", { name: "Ano, odvolat" }).click();
    await expect(page.getByText(/Nemáte udělený žádný souhlas/)).toBeVisible();
    expect((await grantRows(site.weddingId))[0]).toMatchObject({ active: false });
    expect(await subject(site.adminEmail, 3)).toBe(
      "Souhlas s nahlédnutím provozovatele byl odvolán",
    );

    await page.goto(admin(`/zakazky/${site.weddingId}`));
    await guests.getByLabel("Důvod nahlédnutí").fill("Po odvolání souhlasu");
    await guests.getByRole("button", { name: "Zobrazit údaje hostů" }).click();
    await expect(guests.getByText(/Přístup byl odmítnut/)).toBeVisible();
    // odepřený pokus správcům e-mail neposílá, ale je v přehledu
    expect(readMails(site.adminEmail)).toHaveLength(3);
  });
});

test.describe("data a smazání webu", () => {
  test("smazání vyžaduje napsané slovo, ukončí relace, oznámí se a web zmizí", async ({
    page,
    context,
  }) => {
    const site = await seedSite();
    await site.login(context);
    const backup = await backupEmail(site.weddingId);
    await page.goto(appUrl("/data"));
    await expect(page.getByRole("heading", { level: 1, name: "Data a smazání" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stáhnout export" })).toBeVisible();

    await page.getByLabel(/Pro potvrzení napište slovo SMAZAT/).fill("ano");
    await page.getByRole("button", { name: "Smazat web", exact: true }).click();
    await expect(page.getByText("Napište přesně slovo, které je uvedeno nad polem.")).toBeVisible();
    expect(
      await withDb(
        async (db) =>
          (await db.query("select status from se_vezmou.weddings where id = $1", [site.weddingId]))
            .rows[0].status,
      ),
    ).toBe("published");

    await page.getByLabel(/Pro potvrzení napište slovo SMAZAT/).fill("smazat");
    await page.getByRole("button", { name: "Smazat web", exact: true }).click();
    await expect(page).toHaveURL(/\/prihlaseni/);

    const row = await withDb(async (db) => {
      const result = await db.query<{ status: string; purge_at: Date | null }>(
        "select status, purge_at from se_vezmou.weddings where id = $1",
        [site.weddingId],
      );
      return result.rows[0];
    });
    expect(row.status).toBe("deleted");
    expect(row.purge_at).not.toBeNull();
    expect((await sessionState(site.weddingId, site.adminId)).every((s) => s.revoked)).toBe(true);
    expect(await subject(site.adminEmail)).toBe("Svatební web byl smazán");
    expect(await subject(backup)).toBe("Svatební web byl smazán");

    // web páru i správa jsou pryč
    const response = await page.goto(site.url);
    expect(response?.status()).toBe(404);
    await page.goto(appUrl("/pristup"));
    await expect(page).toHaveURL(/\/prihlaseni/);
  });
});

test.describe("izolace mezi svatbami", () => {
  test("správce nevidí ani nepřečte hosty jiné svatby (seznam, úprava, odpověď, export)", async ({
    page,
    context,
  }) => {
    const mine = await seedSite();
    const theirs = await seedSite();
    await mine.login(context);
    const secret = `Cizí Host ${theirs.tag}`;
    const [theirHousehold] = await seedHouseholds(theirs.weddingId, [
      { label: "Cizí", guests: [{ name: secret }] },
    ]);
    await seedHouseholds(mine.weddingId, [{ label: "Moji", guests: [{ name: "Můj Host" }] }]);

    await page.goto(appUrl("/hoste"));
    await expect(page.getByText("Můj Host")).toBeVisible();
    expect(await page.content()).not.toContain(secret);

    for (const path of [`/hoste/domacnost/${theirHousehold}`, `/odpovedi/${theirHousehold}`]) {
      const response = await page.goto(appUrl(path));
      expect(response?.status()).toBe(404);
    }

    await page.goto(appUrl("/hoste"));
    await page.getByLabel("CSV (středník, UTF-8)").check();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Stáhnout export" }).click(),
    ]);
    const text = readFileSync((await download.path())!).toString("utf8");
    expect(text).toContain("Můj Host");
    expect(text).not.toContain(secret);
    expect((await guestRows(theirs.weddingId)).map((g) => g.display_name)).toEqual([secret]);
  });
});

test.describe("anglické rozhraní", () => {
  test("nové obrazovky mají anglické nadpisy a ovládací prvky", async ({ page, context }) => {
    const site = await seedSite();
    await site.login(context);
    await seedHouseholds(site.weddingId, [{ label: "Novak", guests: [{ name: "Jan Novak" }] }]);
    await page.goto(appUrl("/en/hoste"));
    await expect(page.getByRole("heading", { level: 1, name: "Guests" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add a household" })).toBeVisible();
    await expect(page.getByTestId("guest-count")).toHaveText("Households: 1, guests: 1");
    await page.goto(appUrl("/en/hoste/import"));
    await expect(page.getByRole("heading", { level: 1, name: "Import guests" })).toBeVisible();
    await page.goto(appUrl("/en/odpovedi"));
    await expect(page.getByRole("heading", { level: 1, name: "Replies" })).toBeVisible();
    await page.goto(appUrl("/en/odpovedi/nastaveni"));
    await expect(page.getByRole("heading", { level: 1, name: "Reply settings" })).toBeVisible();
    await page.goto(appUrl("/en/pristup"));
    await expect(page.getByRole("heading", { level: 1, name: "Access" })).toBeVisible();
    await expect(page.getByTestId("admins-count")).toHaveText("Administrators: 1 of at most 3");
    await page.goto(appUrl("/en/data"));
    await expect(page.getByRole("heading", { level: 1, name: "Data and deletion" })).toBeVisible();
    await expect(page.getByLabel("To confirm, type the word DELETE")).toBeVisible();
  });
});
