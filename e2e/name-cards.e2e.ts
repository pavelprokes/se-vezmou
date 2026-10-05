import { readFileSync } from "node:fs";
import { appUrl } from "./support/admin";
import { expect, test } from "./support/fixtures";
import { seedHouseholds, seedSite } from "./support/guests";

/**
 * Jmenovky na stůl (docs/konkurence-2026-10.md): odkaz ze seznamu hostů, výběr, náhled ve vzhledu
 * šablony a stažení PDF A4. Běží i v mobilním viewportu.
 */

test.describe("jmenovky na stůl", () => {
  test("výběr, náhled se jmény a PDF k tisku", async ({ page, context }, info) => {
    const site = await seedSite();
    await site.login(context);
    await seedHouseholds(site.weddingId, [
      {
        label: "Novákovi",
        tags: ["Rodina"],
        guests: [{ name: "Jan Novák" }, { name: "Eva Nováková" }],
      },
      { label: "Procházkovi", guests: [{ name: "Bohumila Nováková-Procházková" }] },
    ]);

    await page.goto(appUrl("/hoste"));
    await page.getByRole("link", { name: "Připravit jmenovky" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Jmenovky na stůl" })).toBeVisible();

    // výchozí výběr jsou hosté, kteří přijdou; nikdo zatím neodpověděl
    await expect(page.getByText(/V\stomto\svýběru\snejsou\sžádní\shosté/)).toBeVisible();

    await page.getByLabel("Pro všechny pozvané").check();
    await page.getByRole("button", { name: "Zobrazit náhled" }).click();
    await expect(page.getByTestId("name-cards-count")).toHaveText(/Jmenovek:\s3,\slistů\sA4:\s1/);
    const cards = page.getByRole("img", { name: /^Jmenovka: / });
    await expect(cards).toHaveCount(3);
    // abecedně a jméno je opravdový text v náhledu
    await expect(cards.first()).toHaveAccessibleName("Jmenovka: Bohumila Nováková-Procházková");
    await expect(cards.first().locator("text").first()).toContainText("Bohumila");
    await page.screenshot({ path: info.outputPath("jmenovky.png"), fullPage: true });

    // skupina
    await page.getByLabel("Skupina hostů").selectOption("Rodina");
    await page.getByRole("button", { name: "Zobrazit náhled" }).click();
    await expect(cards).toHaveCount(2);

    // stojánek a stažení PDF
    await page.getByLabel(/Stojánek/).check();
    await page.getByRole("button", { name: "Zobrazit náhled" }).click();
    await expect(page.getByText(/přehněte\spodle\sznačky\sv\spolovině/)).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Stáhnout PDF k tisku" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`jmenovky-${site.slug}.pdf`);
    const pdf = readFileSync((await download.path())!);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  test("PDF bez přihlášení nevydá nic", async ({ request }) => {
    const response = await request.post(appUrl("/hoste/jmenovky/pdf"), {
      form: { kdo: "vsichni" },
      headers: { origin: new URL(appUrl("/")).origin },
    });
    expect(response.status()).toBe(401);
  });
});
