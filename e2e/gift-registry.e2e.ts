import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { EditorBlock } from "../src/admin/site/doc";
import { GUEST_PIN, appUrl } from "./support/admin";
import { withDb } from "./support/db";
import { seedSite } from "./support/guests";

/**
 * Seznam věcných darů s rezervací (docs/plan-funkci-2026-10.md, fáze 2): pár dary spravuje ve správě,
 * host si dar na webu zarezervuje bez účtu, ostatní vidí „zabráno“, vlastní rezervaci zruší; s PINem
 * hostů je seznam až po jeho zadání.
 */

const giftsOn = (blocks: EditorBlock[]): EditorBlock[] =>
  blocks.map((block) =>
    block.type === "gifts"
      ? ({
          ...block,
          enabled: true,
          data: { ...block.data, intro: { cs: "Největší dar je vaše přítomnost." }, account: "" },
        } as EditorBlock)
      : block,
  );

async function addGift(page: Page, title: string, price?: string, url?: string) {
  const form = page.getByRole("region", { name: "Přidat dar" });
  await form.getByRole("group", { name: /Název/ }).getByLabel("Čeština").fill(title);
  if (price) await form.getByLabel("Orientační cena (nepovinné)").fill(price);
  if (url) await form.getByLabel("Odkaz do obchodu (nepovinné)").fill(url);
  await form.getByRole("button", { name: "Přidat dar" }).click();
  await expect(page.getByText("Dar je přidaný.")).toBeVisible();
}

test.describe("seznam věcných darů", () => {
  test("pár přidá dary, host zarezervuje, ostatní vidí zabráno, rezervace jde zrušit", async ({
    page,
    context,
    browser,
  }, info) => {
    const site = await seedSite({ tweak: giftsOn });
    await site.login(context);

    await page.goto(appUrl("/dary"));
    await expect(page.getByRole("heading", { level: 1, name: "Seznam darů" })).toBeVisible();
    await expect(page.getByTestId("gifts-block-off")).toHaveCount(0);
    // bez názvu chyba slovy
    await page.getByRole("button", { name: "Přidat dar" }).click();
    await expect(page.getByText("Vyplňte název daru.")).toBeVisible();
    await addGift(page, "Mixér", "2 500 Kč", "https://example.test/mixer");
    await addGift(page, "Deka na piknik");
    await page.getByRole("button", { name: "Posunout Deka na piknik výš" }).click();
    await expect(
      page.getByTestId("gift-list").getByRole("heading", { level: 3 }).first(),
    ).toHaveText("Deka na piknik");

    // host A zarezervuje mixér se jménem
    const guestA = await browser.newContext();
    const a = await guestA.newPage();
    await a.goto(site.url);
    const registry = a.locator(".site-registry");
    await expect(registry.getByRole("heading", { name: "Seznam darů" })).toBeVisible();
    await expect(registry.getByTestId("registry-item")).toHaveCount(2);
    await registry.getByRole("button", { name: "Zarezervovat: Mixér" }).click();
    await expect(registry.getByLabel("Vaše jméno (nepovinné)")).toBeFocused();
    await registry.getByLabel("Vaše jméno (nepovinné)").fill("Teta Věra");
    await registry.getByRole("button", { name: "Potvrdit rezervaci" }).click();
    await expect(registry.getByText("Hotovo, dar Mixér je zarezervovaný pro vás.")).toBeVisible();
    await expect(registry.getByText("Tento dar máte zarezervovaný.")).toBeVisible();
    await a.screenshot({ path: info.outputPath("dary-host.png"), fullPage: true });

    // host B vidí zabráno a jméno nevidí nikde
    const guestB = await browser.newContext();
    const b = await guestB.newPage();
    await b.goto(site.url);
    const mixer = b.getByTestId("registry-item").filter({ hasText: "Mixér" });
    await expect(mixer).toContainText("Zabráno");
    await expect(mixer.getByRole("button")).toHaveCount(0);
    expect(await b.content()).not.toContain("Teta Věra");

    // pár vidí, kdo dar zarezervoval
    await page.reload();
    await expect(page.getByTestId("gift-list")).toContainText("Zarezervoval(a) Teta Věra");

    // host A rezervaci zruší (jen ze svého prohlížeče)
    await a.reload();
    await a
      .locator(".site-registry")
      .getByRole("button", { name: "Zrušit rezervaci: Mixér" })
      .click();
    await expect(a.getByText("Rezervace daru Mixér je zrušená.")).toBeVisible();
    const free = await withDb((db) =>
      db.query(
        "select count(*)::int as n from se_vezmou.gift_items where wedding_id = $1 and reserved_at is null",
        [site.weddingId],
      ),
    );
    expect(free.rows[0].n).toBe(2);

    // host B zarezervuje deku bez jména, pár rezervaci uvolní
    await b.reload();
    await b
      .locator(".site-registry")
      .getByRole("button", { name: "Zarezervovat: Deka na piknik" })
      .click();
    await b.locator(".site-registry").getByRole("button", { name: "Potvrdit rezervaci" }).click();
    await expect(b.getByText("Hotovo, dar Deka na piknik je zarezervovaný pro vás.")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Uvolnit rezervaci daru Deka na piknik" }).click();
    await expect(page.getByText("Rezervace daru Deka na piknik je uvolněná.")).toBeVisible();
    await page.getByRole("button", { name: "Smazat dar Mixér" }).click();
    await expect(page.getByText("Dar Mixér je smazaný.")).toBeVisible();
    await guestA.close();
    await guestB.close();
  });

  test("s PINem hostů je seznam až po zadání PINu; vypnutá sekce se ve správě ohlásí", async ({
    page,
    context,
    browser,
  }) => {
    const site = await seedSite({ guestPin: GUEST_PIN, tweak: giftsOn });
    await site.login(context);
    await page.goto(appUrl("/dary"));
    await addGift(page, "Sada sklenic");

    const guest = await browser.newContext();
    const g = await guest.newPage();
    await g.goto(site.url);
    await expect(g.getByText("Seznam darů uvidíte po zadání PINu z oznámení.")).toBeVisible();
    expect(await g.content()).not.toContain("Sada sklenic");
    const gate = g.locator(".site-gate").filter({ hasText: "Seznam darů uvidíte" });
    await gate.getByLabel("PIN z oznámení").fill(GUEST_PIN);
    await gate.getByRole("button", { name: "Odemknout" }).click();
    await expect(g.getByTestId("registry-item")).toHaveText(/Sada sklenic/);
    await guest.close();

    // web bez zapnuté sekce Dary: správa to řekne
    const plain = await seedSite();
    await plain.login(context);
    await page.goto(appUrl("/dary"));
    await expect(page.getByTestId("gifts-block-off")).toBeVisible();
  });
});
