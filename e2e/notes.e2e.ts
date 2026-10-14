import { expect, test } from "@playwright/test";
import { apiRequest } from "./hosts";
import { appUrl } from "./support/admin";
import { withDb } from "./support/db";
import { seedSite } from "./support/guests";

/**
 * Soukromé poznámky a dodavatelé (docs/plan-funkci-2026-10.md, fáze 2): kontakt přidat, upravit
 * a smazat, poznámky uložit, souběžná úprava se nahlásí; nic z toho není na webu svatby.
 */

test.describe("poznámky a dodavatelé", () => {
  test("kontakty po druzích, poznámky s hlídáním souběžné úpravy, nic na webu", async ({
    page,
    context,
  }, info) => {
    const site = await seedSite();
    await site.login(context);
    await page.goto(appUrl("/"));
    await page
      .getByRole("navigation", { name: "Hlavní nabídka správy" })
      .getByRole("link", { name: "Poznámky" })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Poznámky a dodavatelé" }),
    ).toBeVisible();

    const form = page.getByRole("region", { name: "Přidat dodavatele" });
    await form.getByRole("button", { name: "Přidat dodavatele" }).click();
    await expect(page.getByText("Vyplňte jméno nebo název firmy.")).toBeVisible();
    await form.getByLabel("Stav").selectOption({ label: "Domluveno" });
    await form.getByLabel("Jméno nebo firma").fill("Foto Klára");
    await form.getByLabel("Kontakt (nepovinné)").fill("+420 777 000 111");
    await form.getByLabel("Web (nepovinné)").fill("https://foto.example.test");
    await form.getByLabel("Poznámka (nepovinné)").fill("Záloha zaplacena");
    await form.getByRole("button", { name: "Přidat dodavatele" }).click();
    await expect(page.getByText("Kontakt je přidaný.")).toBeVisible();
    const list = page.getByTestId("vendor-list");
    await expect(list.getByRole("region", { name: "Fotograf" })).toContainText("Foto Klára");
    await expect(list).toContainText("Domluveno");

    await page.getByRole("button", { name: "Upravit kontakt Foto Klára" }).click();
    const edit = page.getByRole("region", { name: "Upravit dodavatele" });
    await edit.getByLabel("Druh").selectOption({ label: "Video" });
    await edit.getByRole("button", { name: "Uložit změny" }).click();
    await expect(page.getByText("Kontakt je upravený.")).toBeVisible();
    await expect(list.getByRole("region", { name: "Video" })).toContainText("Foto Klára");
    await expect(list.getByRole("region", { name: "Fotograf" })).toHaveCount(0);

    // poznámky
    const notes = page.getByLabel("Poznámky k přípravám");
    await notes.fill("Objednat dort do 1. května.");
    await page.getByRole("button", { name: "Uložit poznámky" }).click();
    await expect(page.getByText("Poznámky jsou uložené.")).toBeVisible();
    await page.screenshot({ path: info.outputPath("poznamky.png"), fullPage: true });
    await page.reload();
    await expect(page.getByLabel("Poznámky k přípravám")).toHaveValue(
      "Objednat dort do 1. května.",
    );

    // jiný správce mezitím uložil: změna se nepřepíše potichu
    await withDb((db) =>
      db.query("update se_vezmou.wedding_notes set rev = rev + 1 where wedding_id = $1", [
        site.weddingId,
      ]),
    );
    await page.getByLabel("Poznámky k přípravám").fill("Můj novější text");
    await page.getByRole("button", { name: "Uložit poznámky" }).click();
    await expect(page.getByText(/Poznámky mezitím upravil jiný správce/)).toBeVisible();

    // nic z toho není na webu svatby
    const { url, options } = apiRequest(`${site.slug}.localhost`, "/");
    const html = await (await page.request.get(url, options)).text();
    expect(html).not.toContain("Foto Klára");

    await page.getByRole("button", { name: "Smazat kontakt Foto Klára" }).click();
    await expect(page.getByText("Kontakt Foto Klára je smazaný.")).toBeVisible();
    await expect(page.getByText("Zatím žádné kontakty.", { exact: false })).toBeVisible();
  });
});
