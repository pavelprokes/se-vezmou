import { expect, test } from "@playwright/test";
import { appUrl, seedManagedSite } from "./support/admin";

/**
 * Jazyk rozhraní správy určuje cesta, ne prohlížeč: bez předpony česky, pod `/en` anglicky. Anglický
 * prohlížeč na české adrese dřív dostal angličtinu a odkaz „Čeština“ v přepínači vedl na tutéž adresu,
 * takže se jazyk nedal přepnout.
 */
test("anglický prohlížeč: česká adresa je česky a přepínač Čeština i English funguje", async ({
  browser,
}) => {
  const site = await seedManagedSite();
  const context = await browser.newContext({ locale: "en-GB" });
  await site.login(context);
  const page = await context.newPage();

  await page.goto(appUrl("/web"));
  await expect(page.locator("html")).toHaveAttribute("lang", "cs");
  const switcher = page.getByRole("navigation", { name: "Jazyk správy" });
  await expect(switcher.getByRole("link", { name: "Čeština" })).toHaveAttribute(
    "aria-current",
    "true",
  );

  await switcher.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(appUrl("/en/web"));
  await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");

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
