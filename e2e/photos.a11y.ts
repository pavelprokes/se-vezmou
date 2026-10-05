import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { appUrl, expectSaved, openBlock, openEditor, seedManagedSite } from "./support/admin";
import {
  chooseFiles,
  enableGallery,
  expectUploaded,
  file,
  jpegWithGps,
  photoGroup,
} from "./support/photos";

/**
 * Přístupnost fotografií (WCAG 2.2 AA, M7c): axe na nahrávání v editoru (prázdný stav, fronta s chybami a průběhem,
 * seznam fotografií s upozorněními), na webu s galerií a na otevřeném prohlížeči (lightbox), česky i anglicky,
 * na počítači i v mobilním viewportu (projekty a11y a a11y-mobile). Ověřuje i viditelné zaměření, cíle dotyku a
 * to, co čtečka dostane (názvy tlačítek, alternativní texty, živé oblasti). Ruční test se čtečkami (MAN-08) zůstává
 * povinný, viz docs/test-plan.md.
 */

test.describe.configure({ timeout: 180_000 });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page) {
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

async function publish(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Zveřejnit změny" }).click();
  await expect(page.getByTestId("publish-result")).toContainText(/Hotovo, web je zveřejněný/);
}

test.describe("axe: nahrávání fotografií v editoru", () => {
  test("prázdný stav, fronta s chybami a seznam fotografií s upozorněním, česky i anglicky", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite({ tweak: enableGallery });
    await site.login(context);
    const gallery = await (async () => {
      await openEditor(page);
      return openBlock(page, "gallery", "Fotografie");
    })();
    await expect(gallery.getByText("Zatím žádné fotografie.")).toBeVisible();
    await expectNoViolations(page);

    // fronta: odmítnuté soubory (chyby slovy) a nahrávání jedné fotografie
    await chooseFiles(gallery, [
      file("iphone.heic", "image/heic", Buffer.from("....ftypheic....")),
      file("kresba.svg", "image/svg+xml", Buffer.from("<svg/>")),
      file("zamek.jpg", "image/jpeg", await jpegWithGps(1800, 1200)),
    ]);
    const queue = gallery.getByRole("list", { name: "Fronta nahrávání" });
    await expect(queue.getByText(/Formát HEIC nepodporujeme/)).toBeVisible();
    await expectNoViolations(page);
    await expectUploaded(gallery, 1);

    // seznam fotografií: popisek je nepovinný, po vyplnění jen jednoho jazyka upozornění na překlad
    const photo = photoGroup(gallery, 1, 1);
    await expectNoViolations(page);
    await photo.getByLabel("Čeština").fill("Pár na zámku");
    await expect(photo.getByText("Popisek uložen.")).toBeVisible();
    await expect(photo.getByText(/Chybí překlad/)).toBeVisible();
    await expectNoViolations(page);

    // potvrzení smazání (druhý krok přímo v místě)
    await photo.getByRole("button", { name: /^Smazat fotografii 1/ }).click();
    await expect(gallery.getByRole("group", { name: /Smazat fotografii 1/ })).toBeVisible();
    await expectNoViolations(page);
    await gallery.getByRole("button", { name: "Zrušit" }).click();
    await expectSaved(page);

    await page.goto(appUrl("/en/web"));
    await expect(page.getByTestId("site-status")).toBeVisible();
    const galleryEn = page.getByTestId("block-gallery");
    await galleryEn.getByRole("button", { name: /^Edit section Photos/ }).click();
    await expect(galleryEn.getByRole("heading", { name: /Uploaded photos \(1\)/ })).toBeVisible();
    await expectNoViolations(page);
  });

  test("ovládání klávesnicí a stav pro čtečky: popisky tlačítek, živé oblasti, viditelné zaměření", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite({ tweak: enableGallery });
    await site.login(context);
    await openEditor(page);
    const gallery = await openBlock(page, "gallery", "Fotografie");
    await chooseFiles(gallery, [
      file("a.jpg", "image/jpeg", await jpegWithGps(1500, 1000, { r: 200, g: 40, b: 40 })),
      file("b.jpg", "image/jpeg", await jpegWithGps(1500, 1000, { r: 40, g: 200, b: 40 })),
    ]);
    await expectUploaded(gallery, 2);

    // výběr souborů je nativní pole s viditelným popiskem a nápovědou
    const input = gallery.getByLabel("Vybrat fotografie");
    await expect(input).toHaveAttribute("aria-describedby", /.+/);
    // každé tlačítko řazení a smazání nese pořadí v názvu
    await expect(gallery.getByRole("button", { name: "Posunout fotografii 1 níž" })).toBeVisible();
    await expect(gallery.getByRole("button", { name: "Posunout fotografii 2 výš" })).toBeVisible();
    await expect(gallery.getByRole("button", { name: /^Smazat fotografii 2/ })).toBeVisible();

    // klávesnicí: tlačítko řazení se stiskne mezerníkem, pozice se ohlásí a zaměření zůstane na tlačítku
    const down = gallery.getByRole("button", { name: "Posunout fotografii 1 níž" });
    await down.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("status").filter({ hasText: /přesunuta na pozici 2/ })).toHaveCount(
      1,
    );
    await expect(gallery.getByRole("button", { name: "Posunout fotografii 2 výš" })).toBeVisible();

    // viditelné zaměření a cíl dotyku alespoň 44 px
    for (const name of [
      /^Posunout fotografii 1 níž/,
      /^Posunout fotografii 2 výš/,
      /^Smazat fotografii 1/,
    ]) {
      const button = gallery.getByRole("button", { name }).first();
      await button.focus();
      const style = await button.evaluate((el) => {
        const css = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return {
          outlineStyle: css.outlineStyle,
          outlineWidth: Number.parseFloat(css.outlineWidth),
          boxShadow: css.boxShadow,
          width: box.width,
          height: box.height,
        };
      });
      expect(style.outlineStyle !== "none" || style.boxShadow !== "none").toBe(true);
      expect(Math.min(style.width, style.height)).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("axe: web páru s galerií a prohlížečem fotografií", () => {
  test("mřížka a otevřený prohlížeč, česky i anglicky", async ({ page, context }) => {
    const site = await seedManagedSite({ tweak: enableGallery });
    await site.login(context);
    await openEditor(page);
    const gallery = await openBlock(page, "gallery", "Fotografie");
    await chooseFiles(gallery, [
      file("a.jpg", "image/jpeg", await jpegWithGps(1500, 1000, { r: 200, g: 40, b: 40 })),
      file("b.jpg", "image/jpeg", await jpegWithGps(1500, 1000, { r: 40, g: 200, b: 40 })),
    ]);
    await expectUploaded(gallery, 2);
    await photoGroup(gallery, 1, 2).getByLabel("Čeština").fill("První fotografie");
    await photoGroup(gallery, 1, 2).getByLabel("English").fill("First photo");
    await expect(photoGroup(gallery, 1, 2).getByText("Popisek uložen.")).toBeVisible();
    await photoGroup(gallery, 2, 2).getByLabel("Čeština").fill("Druhá fotografie");
    await photoGroup(gallery, 2, 2).getByLabel("English").fill("Second photo");
    await expect(photoGroup(gallery, 2, 2).getByText("Popisek uložen.")).toBeVisible();
    await expectSaved(page);
    await publish(page);

    const guest = await context.newPage();
    for (const [path, open, close, dialogName] of [
      ["/", "Zvětšit fotografii: První fotografie", "Zavřít prohlížeč", "Prohlížeč fotografií"],
      ["/en", "Enlarge photo: First photo", "Close viewer", "Photo viewer"],
    ] as const) {
      await guest.goto(`${site.url.replace(/\/$/, "")}${path}`);
      await expect(guest.locator("#galerie button.site-photo")).toHaveCount(2);
      await guest.locator("#galerie").scrollIntoViewIfNeeded();
      await expectNoViolations(guest);

      // tlačítko u fotografie: cíl alespoň 44 px, viditelné zaměření
      const trigger = guest.getByRole("button", { name: open });
      await trigger.focus();
      const outline = await trigger.evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(outline).not.toBe("none");
      const box = await trigger.boundingBox();
      expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);

      await trigger.click();
      const dialog = guest.getByRole("dialog", { name: dialogName });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: close })).toBeFocused();
      // v dialogu stačí počkat na načtení velké fotografie, ať axe nehlásí nedokončený obrázek
      await expect
        .poll(() => dialog.locator("img").evaluate((el) => (el as HTMLImageElement).complete))
        .toBe(true);
      await expectNoViolations(guest);

      // ovládací prvky prohlížeče: cíl alespoň 44 px a viditelné zaměření
      for (const button of await dialog.getByRole("button").all()) {
        await button.focus();
        const style = await button.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return { w: box.width, h: box.height, outline: getComputedStyle(el).outlineStyle };
        });
        expect(Math.min(style.w, style.h)).toBeGreaterThanOrEqual(44);
        expect(style.outline).not.toBe("none");
      }
      await guest.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  });

  test("galerie zamčená PINem hostů má formulář s popiskem a bez fotografií v HTML", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite({ guestPin: "482915", tweak: enableGallery });
    await site.login(context);
    await openEditor(page);
    const gallery = await openBlock(page, "gallery", "Fotografie");
    await chooseFiles(gallery, [file("a.jpg", "image/jpeg", await jpegWithGps(1500, 1000))]);
    await expectUploaded(gallery, 1);
    await photoGroup(gallery, 1, 1).getByLabel("Čeština").fill("Soukromá fotografie");
    await expect(photoGroup(gallery, 1, 1).getByText("Popisek uložen.")).toBeVisible();
    await gallery.getByLabel("Fotografie zobrazit jen po zadání PINu hostů").check();
    await expectSaved(page);
    await publish(page);

    const guest = await context.newPage();
    await guest.goto(site.url);
    await expect(guest.locator("#galerie").getByLabel("PIN z oznámení")).toBeVisible();
    await expectNoViolations(guest);
  });
});
