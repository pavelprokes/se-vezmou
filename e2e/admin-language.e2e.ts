import { expect, test } from "@playwright/test";
import { appUrl, seedManagedSite } from "./support/admin";

/**
 * Jazyk rozhraní správy určuje cesta (bez předpony česky, pod `/en` anglicky). Při vstupu na adresu
 * bez předpony proxy vyjedná jazyk (ADR 0013), takže anglický prohlížeč skončí na `/en/...`; odkaz
 * „Čeština“ v přepínači pak vede na českou adresu a detekce ho už nevrátí (dřív vedl na tutéž adresu
 * a jazyk se nedal přepnout).
 */
test("anglický prohlížeč: vstup anglicky, navigace drží jazyk a přepínač Čeština i English funguje", async ({
  browser,
}) => {
  const site = await seedManagedSite();
  const context = await browser.newContext({ locale: "en-GB" });
  await site.login(context);
  const page = await context.newPage();

  await page.goto(appUrl("/web"));
  await expect(page).toHaveURL(appUrl("/en/web"));
  await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
  const switcher = page.getByRole("navigation", { name: "Administration language" });
  await expect(switcher.getByRole("link", { name: "English" })).toHaveAttribute(
    "aria-current",
    "true",
  );

  await switcher.getByRole("link", { name: "Čeština" }).click();
  await expect(page).toHaveURL(appUrl("/web"));
  await expect(page.locator("html")).toHaveAttribute("lang", "cs");

  await page
    .getByRole("navigation", { name: "Jazyk správy" })
    .getByRole("link", { name: "English" })
    .click();
  await expect(page).toHaveURL(appUrl("/en/web"));

  // Navigace uvnitř anglické správy zůstává anglicky.
  await page
    .getByRole("navigation", { name: "Main menu of the administration" })
    .getByRole("link", { name: "Guests" })
    .click();
  await expect(page).toHaveURL(appUrl("/en/hoste"));
  await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");

  await page
    .getByRole("navigation", { name: "Administration language" })
    .getByRole("link", { name: "Čeština" })
    .click();
  await expect(page).toHaveURL(appUrl("/hoste"));
  await expect(page.locator("html")).toHaveAttribute("lang", "cs");
  await context.close();
});
