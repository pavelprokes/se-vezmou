import { expect, test } from "@playwright/test";
import { appUrl, tenantUrl } from "./support/admin";
import { withDb } from "./support/db";
import { rsvpSettingsRow, seedHouseholds, seedSite } from "./support/guests";
import { waitForMail } from "./support/mail";

/**
 * Vzkaz pro novomanžele a upozornění hostům na změny (docs/plan-funkci-2026-10.md, fáze 1): pár obojí
 * zapne v nastavení, host v odpovědi nechá vzkaz a e-mail se souhlasem, pár vzkaz přečte a pošle
 * upozornění, host se odhlásí odkazem z e-mailu.
 */

async function updatesCount(weddingId: string): Promise<number> {
  return withDb(async (db) => {
    const result = await db.query<{ n: number }>(
      "select count(*)::int as n from se_vezmou.rsvp_updates where wedding_id = $1",
      [weddingId],
    );
    return result.rows[0].n;
  });
}

test.describe("vzkaz a upozornění hostům na změny", () => {
  test("host nechá vzkaz a e-mail, pár pošle upozornění, host se odhlásí", async ({
    page,
    context,
    browser,
  }, info) => {
    const site = await seedSite();
    await seedHouseholds(site.weddingId, [{ label: "Novákovi", guests: [{ name: "Jan Novák" }] }]);
    const guestEmail = `jan-${site.tag}@example.test`;
    await site.login(context);

    // 1. pár zapne obě volby v nastavení odpovědí
    await page.goto(appUrl("/odpovedi/nastaveni"));
    await page.getByLabel("Vzkaz pro novomanžele").check();
    await page.getByLabel("Upozornění hostů na změny").check();
    await page.getByRole("button", { name: "Uložit nastavení" }).click();
    await expect(page.getByText("Nastavení je uložené.")).toBeVisible();
    expect((await rsvpSettingsRow(site.weddingId)).settings.enabled_questions).toMatchObject({
      message: true,
      updates: true,
    });

    // 2. host odpoví se vzkazem a přihlásí se k upozornění (vlastní prohlížeč bez relace správce)
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    await guest.goto(site.url);
    const section = guest.locator("#potvrdit-ucast");
    await section.getByLabel("Vaše jméno").fill("Jan Novák");
    await section.getByRole("button", { name: "Pokračovat" }).click();
    await section
      .getByRole("group", { name: "Jan Novák: Svatební obřad" })
      .getByRole("radio", { name: "Přijde", exact: true })
      .check();
    await section
      .getByRole("group", { name: "Jan Novák: Hostina" })
      .getByRole("radio", { name: "Přijde", exact: true })
      .check();
    await section.getByLabel("Vzkaz pro novomanžele").fill("Moc se těšíme, ať vám to klape!");

    const updates = section.getByRole("group", { name: "Upozornění na změny" });
    await expect(updates.getByLabel("E-mail pro upozornění")).toHaveCount(0);
    await updates.getByLabel(/Pošlete mi e-mail, když se u\s+svatby něco změní/).check();
    // souhlas bez adresy: chyba slovy u pole i v souhrnu
    await section.getByRole("button", { name: "Odeslat odpověď" }).click();
    await expect(updates.getByText("Toto pole je povinné.")).toBeVisible();
    await updates.getByLabel("E-mail pro upozornění").fill(guestEmail);
    await updates.getByLabel("Telefon (nepovinné)").fill("+420 777 123 456");
    await section.getByRole("button", { name: "Odeslat odpověď" }).click();
    await expect(section.getByText("Když se něco změní, pošleme vám e-mail.")).toBeVisible();
    await guest.screenshot({ path: info.outputPath("rsvp-vzkaz.png"), fullPage: true });

    // úprava: souhlas zůstane zaškrtnutý, adresa se hostovi z ochrany soukromí neukáže
    await expect(updates.getByRole("checkbox")).toBeChecked();
    await expect(updates.getByLabel("E-mail pro upozornění")).toHaveValue("");
    await expect(guest.locator("body")).not.toContainText(guestEmail);
    expect(await updatesCount(site.weddingId)).toBe(1);

    // 3. pár vidí vzkaz a přihlášeného hosta a pošle upozornění
    await page.goto(appUrl("/odpovedi"));
    await expect(page.getByTestId("guest-messages")).toContainText(
      "Moc se těšíme, ať vám to klape!",
    );
    await expect(page.getByTestId("updates-count")).toHaveText("Přihlášených hostů: 1");
    const table = page.getByRole("region", { name: "Hosté přihlášení k upozornění" });
    await expect(table).toContainText(guestEmail);
    await expect(table).toContainText("+420 777 123 456");

    // prázdný text: chyba slovy, nic se neodešle
    await page.getByRole("button", { name: "Odeslat upozornění" }).click();
    await expect(page.getByText("Napište text zprávy.")).toBeVisible();
    await page
      .getByLabel("Text zprávy (čeština)")
      .fill("Obřad začíná o hodinu dřív, ve 13:00.\n\nZbytek programu platí.");
    await page.getByRole("button", { name: "Odeslat upozornění" }).click();
    await expect(page.getByText("Upozornění jsme odeslali. Počet příjemců: 1")).toBeVisible();
    await page.screenshot({ path: info.outputPath("odpovedi-upozorneni.png"), fullPage: true });

    const mail = await waitForMail(guestEmail);
    expect(mail.subject).toMatch(/^Změna u\s+svatby Klára a\s+Matěj$/);
    expect(mail.text).toMatch(/Obřad začíná o\s+hodinu dřív/);
    expect(mail.text).toContain(tenantUrl(site.slug));
    const unsubscribe = /^(http:\/\/\S+\/upozorneni\?t=[0-9a-f]{36})$/m.exec(mail.text)?.[1];
    expect(unsubscribe).toBeTruthy();

    // 4. host se odhlásí: otevření odkazu nic nemění, až tlačítko
    await guest.goto(unsubscribe!);
    await expect(
      guest.getByRole("heading", { level: 1, name: "Odhlášení upozornění" }),
    ).toBeVisible();
    expect(await updatesCount(site.weddingId)).toBe(1);
    await guest.getByRole("button", { name: "Odhlásit upozornění" }).click();
    await expect(guest.getByText("Hotovo, další upozornění vám už nepošleme.")).toBeVisible();
    expect(await updatesCount(site.weddingId)).toBe(0);

    // znovu tentýž odkaz: neplatný, nic se neprozradí
    await guest.goto(unsubscribe!);
    await guest.getByRole("button", { name: "Odhlásit upozornění" }).click();
    await expect(guest.getByText(/Odkaz je neplatný, nebo jste se už odhlásili/)).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("updates-count")).toHaveText("Přihlášených hostů: 0");
    await expect(page.getByRole("button", { name: "Odeslat upozornění" })).toHaveCount(0);
    await guestContext.close();
  });

  test("odhlášení z cizího původu se odmítne, odkaz bez tokenu je neplatný", async ({
    page,
    request,
  }) => {
    const site = await seedSite();
    const foreign = await request.post(tenantUrl(site.slug, "/upozorneni/odhlasit"), {
      form: { t: "0".repeat(36) },
      headers: { origin: "https://example.com" },
      maxRedirects: 0,
    });
    expect(foreign.status()).toBe(403);
    await page.goto(tenantUrl(site.slug, "/upozorneni"));
    await expect(page.getByText(/Odkaz je neplatný, nebo jste se už odhlásili/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Odhlásit upozornění" })).toHaveCount(0);
  });
});
