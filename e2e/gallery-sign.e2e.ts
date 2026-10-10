import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  appUrl,
  block,
  expectSaved,
  openBlock,
  openEditor,
  seedManagedSite,
} from "./support/admin";

/**
 * Cedulka s QR kódem galerie (docs/plan-funkci-2026-10.md, fáze 1): odkaz z bloku Fotky v editoru,
 * náhled ve vzhledu šablony, adresa s UTM u vlastní galerie autora a PDF A4 k tisku.
 */

const OWN_GALLERY = "https://photos.svatebni-fotograf-cechy.cz/s/e2eToken123/klara-a-matej";

test.describe("cedulka s QR kódem galerie", () => {
  test("z editoru přes náhled k PDF; vlastní galerie dostane UTM", async ({
    page,
    context,
  }, info) => {
    const site = await seedManagedSite({ template: "eukalyptus", palette: "bordo" });
    await site.login(context);
    await openEditor(page);

    const gallery = await openBlock(page, "gallery", "Fotografie");
    const toggle = block(page, "gallery").getByRole("checkbox", {
      name: "Zobrazit na webu: Fotografie",
    });
    if (!(await toggle.isChecked())) await toggle.check();
    await gallery.getByLabel("Přidat odkaz na externí fotogalerii").check();
    // bez platné adresy cedulka v editoru není
    await expect(gallery.getByRole("link", { name: "Cedulka s QR kódem na stůl" })).toHaveCount(0);
    await gallery.getByLabel("Adresa galerie").fill(OWN_GALLERY);
    await expectSaved(page);

    await gallery.getByRole("link", { name: "Cedulka s QR kódem na stůl" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Cedulka s QR kódem galerie" }),
    ).toBeVisible();

    const url = new URL((await page.getByTestId("gallery-sign-url").textContent()) ?? "");
    expect(url.origin + url.pathname).toBe(OWN_GALLERY);
    expect(url.searchParams.get("utm_source")).toBe("se-vezmou");
    expect(url.searchParams.get("utm_medium")).toBe("qr-cedulka");
    expect(url.searchParams.get("utm_campaign")).toBe("galerie-svatby");

    // výchozí: text pro nahrávání, oba jazyky webu (cs i en)
    const preview = page.getByRole("img", { name: /^Cedulka s QR kódem: / });
    await expect(preview).toHaveAccessibleName("Cedulka s QR kódem: Přidejte své fotky");
    await expect(preview.locator("text").first()).toHaveText("KLÁRA & MATĚJ");
    await expect(preview).toContainText("Share your photos");
    await page.screenshot({ path: info.outputPath("cedulka.png"), fullPage: true });

    // jen prohlížení, A5, jen česky
    await page.getByLabel(/Fotky ze svatby/).check();
    await page.getByLabel(/A5 ke vchodu/).check();
    await page.getByLabel("Jen česky").check();
    await page.getByRole("button", { name: "Zobrazit náhled" }).click();
    await expect(preview).toHaveAccessibleName("Cedulka s QR kódem: Fotky ze svatby");
    await expect(preview).not.toContainText("Wedding photos");
    await expect(page.getByText(/Řežte podle značek na A5/)).toBeVisible();

    // stažení bere právě zaškrtnuté volby
    await page.getByLabel(/10\s×\s15\scm/).check();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Stáhnout PDF k tisku" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`cedulka-galerie-${site.slug}.pdf`);
    const pdf = readFileSync((await download.path())!);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  test("bez odkazu na galerii stránka pošle pár do editoru", async ({ page, context }) => {
    const site = await seedManagedSite();
    await site.login(context);
    await page.goto(appUrl("/web/cedulka"));
    await expect(page.getByText(/zatím není odkaz na galerii/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Přejít do úprav webu" })).toBeVisible();
    const response = await page.request.post(appUrl("/web/cedulka/pdf"), {
      form: { format: "a5" },
      headers: { origin: new URL(appUrl("/")).origin },
    });
    expect(response.status()).toBe(404);
  });

  test("PDF z cizího původu se odmítne a bez přihlášení nevydá nic", async ({ request }) => {
    const foreign = await request.post(appUrl("/web/cedulka/pdf"), {
      form: { format: "a5" },
      headers: { origin: "https://example.com" },
    });
    expect(foreign.status()).toBe(403);
    const anonymous = await request.post(appUrl("/web/cedulka/pdf"), {
      form: { format: "a5" },
      headers: { origin: new URL(appUrl("/")).origin },
    });
    expect(anonymous.status()).toBe(401);
  });
});
