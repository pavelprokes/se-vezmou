import { uniqueTag } from "./support/db";
import { expect, test } from "./support/fixtures";
import { admin, loginAsOperator, seedOperator, seedOpsWedding } from "./support/ops";

/**
 * Provozní administrace na telefonu (M9): přihlášení, hledání, detail zakázky a zásah. Běží v projektu
 * e2e-mobile (Pixel 7, dotykový vstup) a pro jistotu i na počítači. Po každé akci se čeká na viditelný výsledek.
 */

// Plynulé posouvání by klikání na prvky mimo obraz zdržovalo; jde o chování, ne o vzhled.
test.use({ reducedMotion: "reduce" });

test("přihlášení, hledání zakázky, detail a poznámka na telefonu", async ({ page }) => {
  const operator = await seedOperator({ role: "support", enrolled: true });
  const base = uniqueTag();
  const w = await seedOpsWedding({ tag: base });
  await loginAsOperator(page, operator);

  // nabídka je dostupná i na úzkém displeji (zalamuje se, nic se neschovává za ikonu)
  const nav = page.getByRole("navigation", { name: "Hlavní nabídka provozní administrace" });
  await nav.getByRole("link", { name: "Zakázky" }).click();
  await page.waitForURL(admin("/zakazky"));

  await page.getByLabel("Hledat").fill(base);
  await page.getByRole("button", { name: "Použít filtry" }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByRole("status").filter({ hasText: /Nalezena\s1\szakázka/ })).toBeVisible();

  // stránka se nikdy nezobrazí vodorovně posuvná (tabulka se posouvá v oblasti)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("link", { name: w.names }).click();
  await page.waitForURL(admin(`/zakazky/${w.weddingId}`));
  await expect(page.getByRole("heading", { level: 1, name: `Zakázka ${w.names}` })).toBeVisible();

  const note = page.getByRole("region", { name: "Nová poznámka", exact: true });
  await note.getByLabel("Poznámka").fill("Zavolat páru v pondělí.");
  await note.getByRole("button", { name: "Přidat poznámku" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Poznámka byla přidána." }),
  ).toBeVisible();
  await expect(page.getByText("Zavolat páru v pondělí.")).toBeVisible();

  await page.getByRole("button", { name: "Odhlásit se" }).click();
  await page.waitForURL(admin("/prihlaseni"));
});
