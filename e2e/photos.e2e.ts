import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { apiRequest, PORT } from "./hosts";
import {
  appUrl,
  expectSaved,
  GUEST_PIN,
  openBlock,
  openEditor,
  seedManagedSite,
} from "./support/admin";
import { OG_BASE, ogHits } from "./support/og-server";
import {
  TAJNA_ZNACKA,
  chooseFiles,
  enableGallery,
  expectUploaded,
  file,
  jpegWithGps,
  mediaRows,
  openGallery,
  photoGroup,
} from "./support/photos";

/**
 * Fotografie páru na Cloudflare R2 (M7c, docs/adr/0006-photo-storage.md), proti produkčnímu sestavení s úložištěm
 * v paměti (`STORAGE_DRIVER=memory`): nahrání přes podepsanou adresu, fronta, zpracování na serveru (typ podle obsahu,
 * EXIF a GPS pryč, varianty), popisek povinný nebo dekorativní, řazení, mazání, doručení přes `/media/{id}/{šířka}`,
 * přístupný prohlížeč, fotografie chráněné PINem hostů, izolace svateb a kopie obrázku karty externí galerie.
 */

test.describe.configure({ timeout: 180_000 });

async function publish(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Zveřejnit změny" }).click();
  const result = page.getByTestId("publish-result");
  await expect(result).toContainText(
    /Hotovo, web je zveřejněný ve verzi \d+|nejde zveřejnit|nepodařilo/,
  );
  expect((await result.textContent()) ?? "").toMatch(/Hotovo/);
}

const tenant = (slug: string) => `${slug}.localhost`;

/** Surová odpověď bez následování přesměrování a bez cookies (anonymní návštěvník). */
async function visitorGet(
  request: import("@playwright/test").APIRequestContext,
  slug: string,
  path: string,
) {
  const call = apiRequest(tenant(slug), path);
  return request.get(call.url, call.options);
}

test.describe("nahrání, zpracování a zveřejnění", () => {
  test("fotografie s polohou: popisek, zveřejnění, doručení bez EXIF a GPS, varianty v AVIF i WebP", async ({
    page,
    context,
    request,
  }) => {
    const site = await seedManagedSite({ tweak: enableGallery });
    await site.login(context);
    const gallery = await openGallery(page);
    await expect(gallery.getByLabel("Vybrat fotografie")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp",
    );

    const original = await jpegWithGps(3000, 2000);
    expect(original.includes(Buffer.from(TAJNA_ZNACKA))).toBe(true);
    await chooseFiles(gallery, [file("zamek.jpg", "image/jpeg", original)]);
    await expectUploaded(gallery, 1);

    const photo = photoGroup(gallery, 1, 1);
    await expect(photo).toBeVisible();
    // bez popisku se fotografie nezveřejní: upozornění textem
    await expect(photo.getByText(/Chybí popisek/)).toBeVisible();
    await photo.getByLabel("Čeština").fill("Pár na zámku");
    await photo.getByLabel("English").fill("The couple at the chateau");
    await expect(photo.getByText("Popisek uložen.")).toBeVisible();
    await expect(photo.getByText(/Chybí popisek/)).toHaveCount(0);
    await expectSaved(page);

    // databáze: hotové médium se šesti variantami pod {svatba}/{médium}/
    const [row, ...others] = await mediaRows(site.weddingId);
    expect(others).toEqual([]);
    expect(row).toMatchObject({ kind: "photo", status: "ready", variants: 6, decorative: false });
    expect(row.storage_path).toBe(`${site.weddingId}/${row.id}/`);
    expect(row.alt).toEqual({ cs: "Pár na zámku", en: "The couple at the chateau" });

    await publish(page);

    // web páru: picture se srcset (AVIF před WebP), rozměry, lazy, alt
    const guest = await context.newPage();
    await guest.goto(site.url);
    const picture = guest.locator("#galerie picture").first();
    await expect(picture).toBeVisible();
    const types = await picture
      .locator("source")
      .evaluateAll((sources) => sources.map((source) => source.getAttribute("type")));
    expect(types).toEqual(["image/avif", "image/webp"]);
    await expect(picture.locator("source").first()).toHaveAttribute(
      "srcset",
      `/media/${row.id}/640?f=avif 640w, /media/${row.id}/1280?f=avif 1280w, /media/${row.id}/1920?f=avif 1920w`,
    );
    const img = picture.locator("img");
    await expect(img).toHaveAttribute("alt", "Pár na zámku");
    await expect(img).toHaveAttribute("loading", "lazy");
    await expect(img).toHaveAttribute("width", "1920");
    await expect(img).toHaveAttribute("height", "1280");
    // obrázek se opravdu načetl z vlastního původu
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);

    // doručení: přesměrování na podepsanou adresu, veřejné médium bez cookie smí do sdílené mezipaměti
    const redirect = await visitorGet(request, site.slug, `/media/${row.id}/1280?f=avif`);
    expect(redirect.status()).toBe(302);
    expect(redirect.headers()["location"]).toMatch(/^\/api\/dev-storage\?key=/);
    expect(redirect.headers()["cache-control"]).toBe(
      "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
    );
    // Next přidává k `Vary` i své záhlaví RSC; podstatné je, že `Cookie` je mezi nimi
    expect(redirect.headers()["vary"]).toContain("Cookie");
    expect(redirect.headers()["x-robots-tag"]).toContain("noindex");
    const served = await request.get(`http://127.0.0.1:${PORT}${redirect.headers()["location"]}`);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/avif");
    expect((await sharp(await served.body()).metadata()).width).toBe(1280);

    // žádná varianta nenese EXIF ani GPS
    for (const [width, format] of [
      [640, "webp"],
      [1280, "webp"],
      [1920, "webp"],
      [640, "avif"],
      [1920, "avif"],
    ] as const) {
      const response = await visitorGet(
        request,
        site.slug,
        `/media/${row.id}/${width}?f=${format}`,
      );
      expect(response.status()).toBe(302);
      const body = await (
        await request.get(`http://127.0.0.1:${PORT}${response.headers()["location"]}`)
      ).body();
      expect(body.length).toBeGreaterThan(100);
      for (const needle of [TAJNA_ZNACKA, "Exif", "GPS"]) {
        expect(body.includes(Buffer.from(needle)), `${width}.${format}: ${needle}`).toBe(false);
      }
      const meta = await sharp(body).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.width).toBe(width);
    }

    // neexistující varianta, neplatný formát, neznámé médium: prázdné 404 bez indexace
    for (const path of [
      `/media/${row.id}/777?f=webp`,
      `/media/${row.id}/640?f=jpeg`,
      `/media/${row.id}/abc`,
      `/media/00000000-0000-4000-8000-000000000999/640`,
    ]) {
      const missing = await visitorGet(request, site.slug, path);
      expect(missing.status(), path).toBe(404);
      expect(await missing.text()).toBe("");
      expect(missing.headers()["x-robots-tag"]).toContain("noindex");
    }
  });

  test("bez popisku se fotografie nezveřejní, s příznakem dekorativní ano (prázdné alt)", async ({
    page,
    context,
    request,
  }) => {
    const site = await seedManagedSite({ tweak: enableGallery });
    await site.login(context);
    const gallery = await openGallery(page);
    await chooseFiles(gallery, [
      file("bez-popisku.jpg", "image/jpeg", await jpegWithGps(1400, 900)),
    ]);
    await expectUploaded(gallery, 1);
    const [row] = await mediaRows(site.weddingId);
    await expectSaved(page);

    await publish(page);
    // upozornění po zveřejnění: slovy, v seznamu problémů
    await expect(page.getByTestId("issues")).toContainText("Fotografie bez popisku se nezveřejní");

    const guest = await context.newPage();
    await guest.goto(site.url);
    await expect(guest.locator("#galerie")).toHaveCount(0);
    await expect(guest.locator("nav a[href='#galerie']")).toHaveCount(0);
    // nezveřejněná fotografie se nedoručuje ani na přímou adresu
    expect((await visitorGet(request, site.slug, `/media/${row.id}/640`)).status()).toBe(404);

    // dekorativní: zveřejní se s prázdným alt
    const photo = photoGroup(gallery, 1, 1);
    await photo.getByLabel("Dekorativní fotografie (bez popisku)").check();
    await expect(photo.getByText("Popisek uložen.")).toBeVisible();
    await expectSaved(page);
    await publish(page);
    await guest.reload();
    await expect(guest.locator("#galerie img")).toHaveAttribute("alt", "");
    expect((await visitorGet(request, site.slug, `/media/${row.id}/640`)).status()).toBe(302);
  });

  test("chybějící překlad popisku zveřejnění nebrání, hlásí se a web ukáže dostupný jazyk", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite({ tweak: enableGallery });
    await site.login(context);
    const gallery = await openGallery(page);
    await chooseFiles(gallery, [file("a.jpg", "image/jpeg", await jpegWithGps(1400, 900))]);
    await expectUploaded(gallery, 1);
    const photo = photoGroup(gallery, 1, 1);
    await photo.getByLabel("Čeština").fill("Jen česky");
    await expect(photo.getByText("Popisek uložen.")).toBeVisible();
    // upozornění pod polem (stejné jako u ostatních textů) a souhrn překladů
    await expect(photo.getByText(/Chybí překlad/)).toBeVisible();
    await expectSaved(page);
    await publish(page);
    const guest = await context.newPage();
    await guest.goto(`${site.url}en`);
    const img = guest.locator("#galerie img");
    await expect(img).toHaveAttribute("alt", "Jen česky");
    await expect(img).toHaveAttribute("lang", "cs");
  });
});

test.describe("fronta nahrávání: odmítnuté soubory", () => {
  test("HEIC, SVG a GIF se odmítnou v prohlížeči, převlečený HTML soubor server podle obsahu", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite({ tweak: enableGallery });
    await site.login(context);
    const gallery = await openGallery(page);
    await chooseFiles(gallery, [
      file("iphone.heic", "image/heic", Buffer.from("....ftypheic....")),
      file("kresba.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
      file("animace.gif", "image/gif", Buffer.from("GIF89a")),
      file("podvrh.jpg", "image/jpeg", Buffer.from("<html><script>alert(1)</script></html>")),
    ]);
    const queue = gallery.getByRole("list", { name: "Fronta nahrávání" });
    await expect(queue.getByText(/Formát HEIC nepodporujeme/)).toBeVisible();
    await expect(queue.getByText(/Tento typ souboru nepřijímáme/)).toHaveCount(2);
    await expect(queue.getByText(/Soubor není JPEG, PNG ani WebP/)).toBeVisible({
      timeout: 30_000,
    });
    // typ i SVG se k serveru vůbec nedostaly; podvržený soubor založil jen záznam, který selhal
    const rows = await mediaRows(site.weddingId);
    expect(rows.map((r) => [r.status, r.failure_code])).toEqual([["failed", "unsupported_type"]]);
    // chybné soubory jde z fronty odebrat; záznam selhaného nahrání se tím uklidí
    await queue.getByRole("button", { name: /^Odebrat z fronty: podvrh\.jpg/ }).click();
    await expect.poll(async () => (await mediaRows(site.weddingId)).length).toBe(0);
    // u chyb, které zopakování nespraví, tlačítko Zkusit znovu není
    await expect(queue.getByRole("button", { name: /Zkusit znovu/ })).toHaveCount(0);
  });

  test("nahrávání se ohlašuje čtečce a průběh je pojmenovaný ukazatel", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite({ tweak: enableGallery });
    await site.login(context);
    const gallery = await openGallery(page);
    await chooseFiles(gallery, [file("zamek.jpg", "image/jpeg", await jpegWithGps(2200, 1400))]);
    await expectUploaded(gallery, 1);
    await expect(
      page.getByRole("status").filter({ hasText: "zamek.jpg: nahráno a zpracováno." }),
    ).toHaveCount(1);
  });
});

test.describe("pořadí, mazání a export", () => {
  test("řazení tlačítky, pořadí se uloží a platí na webu; prohlížeč listuje šipkami a Esc zavře", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite({ tweak: enableGallery });
    await site.login(context);
    const gallery = await openGallery(page);
    await chooseFiles(gallery, [
      file("prvni.jpg", "image/jpeg", await jpegWithGps(1400, 900, { r: 200, g: 40, b: 40 })),
      file("druha.jpg", "image/jpeg", await jpegWithGps(1400, 900, { r: 40, g: 200, b: 40 })),
    ]);
    await expectUploaded(gallery, 2);
    await photoGroup(gallery, 1, 2).getByLabel("Čeština").fill("První fotografie");
    await expect(photoGroup(gallery, 1, 2).getByText("Popisek uložen.")).toBeVisible();
    await photoGroup(gallery, 2, 2).getByLabel("Čeština").fill("Druhá fotografie");
    await expect(photoGroup(gallery, 2, 2).getByText("Popisek uložen.")).toBeVisible();

    // první nelze posunout výš, druhá níž
    await expect(
      photoGroup(gallery, 1, 2).getByRole("button", { name: /Posunout fotografii 1 výš/ }),
    ).toBeDisabled();
    await expect(
      photoGroup(gallery, 2, 2).getByRole("button", { name: /Posunout fotografii 2 níž/ }),
    ).toBeDisabled();

    // druhou posuneme nahoru: pozice se ohlásí a zaměření zůstane na tlačítku
    await photoGroup(gallery, 2, 2)
      .getByRole("button", { name: /Posunout fotografii 2 výš/ })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: /Fotografie přesunuta na pozici 1/ }),
    ).toHaveCount(1);
    await expect(photoGroup(gallery, 1, 2).getByLabel("Čeština")).toHaveValue("Druhá fotografie");
    await expect(
      photoGroup(gallery, 1, 2).getByRole("button", { name: /Posunout fotografii 1 níž/ }),
    ).toBeFocused();
    await expectSaved(page);
    await publish(page);

    const guest = await context.newPage();
    await guest.goto(site.url);
    const alts = guest.locator("#galerie button.site-photo img");
    await expect(alts).toHaveCount(2);
    expect(await alts.evaluateAll((items) => items.map((i) => i.getAttribute("alt")))).toEqual([
      "Druhá fotografie",
      "První fotografie",
    ]);

    // přístupný prohlížeč: klávesnice, focus, Esc, návrat zaměření
    const first = guest.getByRole("button", { name: "Zvětšit fotografii: Druhá fotografie" });
    await first.focus();
    await guest.keyboard.press("Enter");
    const dialog = guest.getByRole("dialog", { name: "Prohlížeč fotografií" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Zavřít prohlížeč" })).toBeFocused();
    await expect(dialog.getByRole("img", { name: "Druhá fotografie" })).toBeVisible();
    await expect(dialog.getByText(/Fotografie 1\sz\s2/)).toBeVisible();
    await guest.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("img", { name: "První fotografie" })).toBeVisible();
    await expect(dialog.getByText(/Fotografie 2\sz\s2/)).toBeVisible();
    await guest.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("img", { name: "Druhá fotografie" })).toBeVisible();
    await guest.keyboard.press("ArrowLeft");
    await expect(dialog.getByRole("img", { name: "První fotografie" })).toBeVisible();
    // zaměření zůstává v dialogu: po mnoha stisknutích Tab ho nikdy neopustí
    for (let i = 0; i < 7; i++) {
      await guest.keyboard.press("Tab");
      expect(await guest.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
    }
    await guest.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(first).toBeFocused();
    // klik na tlačítko Zavřít a na pozadí zavře prohlížeč
    await first.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Zavřít prohlížeč" }).click();
    await expect(dialog).toBeHidden();
    await expect(first).toBeFocused();
  });

  test("smazání: soubory i záznam zmizí a fotografie přestane být dostupná hned, i před novou publikací", async ({
    page,
    context,
    request,
  }) => {
    const site = await seedManagedSite({ tweak: enableGallery });
    await site.login(context);
    const gallery = await openGallery(page);
    await chooseFiles(gallery, [file("a.jpg", "image/jpeg", await jpegWithGps(1400, 900))]);
    await expectUploaded(gallery, 1);
    await photoGroup(gallery, 1, 1).getByLabel("Čeština").fill("K smazání");
    await expect(photoGroup(gallery, 1, 1).getByText("Popisek uložen.")).toBeVisible();
    await expectSaved(page);
    await publish(page);
    const [row] = await mediaRows(site.weddingId);
    expect((await visitorGet(request, site.slug, `/media/${row.id}/640`)).status()).toBe(302);

    const guest = await context.newPage();
    await guest.goto(site.url);
    await expect(guest.locator("#galerie img")).toHaveCount(1);

    await photoGroup(gallery, 1, 1)
      .getByRole("button", { name: /^Smazat fotografii 1/ })
      .click();
    await expect(gallery.getByText(/Smazat fotografii 1\snadobro/)).toBeVisible();
    await gallery.getByRole("button", { name: "Ano, smazat" }).click();
    await expect(gallery.getByText("Fotografie smazána.")).toBeVisible();
    await expect(gallery.getByText("Zatím žádné fotografie.")).toBeVisible();
    expect(await mediaRows(site.weddingId)).toEqual([]);
    await expectSaved(page);

    // bez nové publikace: doručení vrací 404 a web ji ze snímku vyřadí
    expect((await visitorGet(request, site.slug, `/media/${row.id}/640`)).status()).toBe(404);
    await guest.reload();
    await expect(guest.locator("#galerie")).toHaveCount(0);
  });

  test("export: odkazy ke stažení největší varianty každé fotografie", async ({
    page,
    context,
    request,
  }) => {
    const site = await seedManagedSite({ tweak: enableGallery });
    await site.login(context);
    const gallery = await openGallery(page);
    await chooseFiles(gallery, [file("a.jpg", "image/jpeg", await jpegWithGps(2200, 1400))]);
    await expectUploaded(gallery, 1);
    await gallery.getByRole("button", { name: "Stáhnout všechny fotografie" }).click();
    const link = gallery.getByRole("link", { name: /^Stáhnout foto-01\.webp/ });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    const response = await request.get(`http://127.0.0.1:${PORT}${href}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toContain('filename="foto-01.webp"');
    expect((await sharp(await response.body()).metadata()).width).toBe(1920);
  });
});

test.describe("fotografie chráněné PINem hostů a izolace svateb", () => {
  test("chráněné fotografie nejsou v HTML ani v doručení bez PINu, po PINu ano", async ({
    page,
    context,
    request,
  }) => {
    const site = await seedManagedSite({ guestPin: GUEST_PIN, tweak: enableGallery });
    await site.login(context);
    const gallery = await openGallery(page);
    await chooseFiles(gallery, [file("a.jpg", "image/jpeg", await jpegWithGps(1400, 900))]);
    await expectUploaded(gallery, 1);
    await photoGroup(gallery, 1, 1).getByLabel("Čeština").fill("Soukromá fotografie");
    await expect(photoGroup(gallery, 1, 1).getByText("Popisek uložen.")).toBeVisible();
    await gallery.getByLabel("Fotografie zobrazit jen po zadání PINu hostů").check();
    await expectSaved(page);
    await publish(page);
    const [row] = await mediaRows(site.weddingId);

    const guest = await (await page.context().browser()!.newContext()).newPage();
    await guest.goto(site.url);
    const html = await guest.content();
    expect(html).not.toContain(row.id);
    expect(html).not.toContain("Soukromá fotografie");
    // (adresa fotografie `/media/{id}/…`; `/_next/static/media/` jsou písma)
    expect(html).not.toMatch(/(?<!static)\/media\/[0-9a-f]{8}-/);
    const region = guest.locator("#galerie");
    await expect(region.getByLabel("PIN z pozvánky")).toBeVisible();
    expect((await visitorGet(request, site.slug, `/media/${row.id}/640`)).status()).toBe(404);
    // ani přes prohlížeč bez relace
    const anonymous = await guest.evaluate(
      async (path) => (await fetch(path)).status,
      `/media/${row.id}/640`,
    );
    expect(anonymous).toBe(404);

    // PIN z pozvánky odemkne fotografii i její doručení (cookie hosta)
    await region.getByLabel("PIN z pozvánky").fill(GUEST_PIN);
    const answered = guest.waitForResponse((r) => r.request().method() === "POST");
    await region.getByRole("button", { name: "Odemknout" }).click();
    await answered;
    await expect(region.locator("img")).toHaveAttribute("alt", "Soukromá fotografie");
    await region.locator("img").scrollIntoViewIfNeeded();
    await expect
      .poll(() => region.locator("img").evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const unlocked = await guest.evaluate(async (path) => {
      const response = await fetch(path);
      return { status: response.status, type: response.headers.get("content-type") };
    }, `/media/${row.id}/640`);
    expect(unlocked).toEqual({ status: 200, type: "image/webp" });
  });

  test("správce jiné svatby cizí fotografii nevidí a web jiné svatby ji nedoručí", async ({
    page,
    context,
    request,
    browser,
  }) => {
    const a = await seedManagedSite({ tweak: enableGallery });
    const b = await seedManagedSite({ tweak: enableGallery });
    await a.login(context);
    const gallery = await openGallery(page);
    await chooseFiles(gallery, [file("a.jpg", "image/jpeg", await jpegWithGps(1400, 900))]);
    await expectUploaded(gallery, 1);
    await photoGroup(gallery, 1, 1).getByLabel("Čeština").fill("Fotografie svatby A");
    await expect(photoGroup(gallery, 1, 1).getByText("Popisek uložen.")).toBeVisible();
    await expectSaved(page);
    await publish(page);
    const [row] = await mediaRows(a.weddingId);

    // doručení na webu svatby B s identifikátorem fotografie svatby A: 404 (i na webu A funguje)
    expect((await visitorGet(request, a.slug, `/media/${row.id}/640`)).status()).toBe(302);
    expect((await visitorGet(request, b.slug, `/media/${row.id}/640`)).status()).toBe(404);

    // správce B nedostane náhled fotografie svatby A přes rozhraní správy
    const otherContext = await browser.newContext();
    await b.login(otherContext);
    const other = await otherContext.newPage();
    await other.goto(appUrl("/"));
    const status = await other.evaluate(
      async (path) => (await fetch(path)).status,
      `/media/${row.id}/640`,
    );
    expect(status).toBe(404);
    // správce A ano (náhled v editoru)
    const own = await page.evaluate(
      async (path) => (await fetch(path)).status,
      `/media/${row.id}/640?f=webp`,
    );
    expect(own).toBe(200);
    // bez relace je náhled v rozhraní správy také 404
    const anonymousContext = await browser.newContext();
    const anonymous = await anonymousContext.newPage();
    await anonymous.goto(appUrl("/prihlaseni"));
    expect(
      await anonymous.evaluate(async (path) => (await fetch(path)).status, `/media/${row.id}/640`),
    ).toBe(404);
    // editor svatby B nenese nic z fotografií svatby A
    await other.goto(appUrl("/web"));
    await expect(other.locator("body")).not.toContainText("Fotografie svatby A");
    await otherContext.close();
    await anonymousContext.close();
  });
});

test.describe("obrázek karty externí galerie se kopíruje do vlastního úložiště", () => {
  async function addLink(page: Page, url: string) {
    const gallery = await openBlock(page, "gallery", "Fotografie");
    await gallery.getByLabel("Přidat odkaz na externí fotogalerii").check();
    await gallery.getByLabel("Adresa galerie").fill(url);
    await gallery.getByLabel("Adresa galerie").blur();
    return gallery;
  }

  test("server obrázek stáhne jednou, překóduje ho bez metadat; host cizí obrázek nenačítá", async ({
    page,
    context,
    request,
  }) => {
    const site = await seedManagedSite({ tweak: enableGallery });
    await site.login(context);
    await openEditor(page);
    const path = `/galerie?t=${site.tag}`;
    const gallery = await addLink(page, `${OG_BASE}${path}`);
    await expect(gallery.getByText("Náhled odkazu se načetl.")).toBeVisible();
    await expectSaved(page);
    await publish(page);

    const cards = (await mediaRows(site.weddingId)).filter((r) => r.kind === "card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ status: "ready", decorative: true, variants: 4 });
    // stáhl ho server, a to jednou
    expect(await ogHits(`/cover.jpg?t=${site.tag}`)).toBe(1);

    const guest = await context.newPage();
    const foreign: string[] = [];
    guest.on("request", (r) => {
      if (new URL(r.url()).hostname !== `${site.slug}.localhost`) foreign.push(r.url());
    });
    await guest.goto(site.url);
    const image = guest.locator("#galerie a.site-linkcard img");
    await expect(image).toHaveCount(1);
    await expect(image).toHaveAttribute("alt", "");
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    expect(foreign).toEqual([]);
    expect(await ogHits(`/cover.jpg?t=${site.tag}`)).toBe(1);
    expect((await visitorGet(request, site.slug, `/media/${cards[0].id}/640`)).status()).toBe(302);
    // obrázek karty není fotografie galerie: nevyplní mřížku a není v exportu
    await expect(guest.locator("#galerie button.site-photo")).toHaveCount(0);
  });

  test("SVG, převlečený HTML soubor, obří a „bombový“ obrázek ani přesměrování na loopback se nezkopírují, odkaz zůstane", async ({
    page,
    context,
  }) => {
    const site = await seedManagedSite({ tweak: enableGallery });
    await site.login(context);
    await openEditor(page);
    const gallery = await openBlock(page, "gallery", "Fotografie");
    await gallery.getByLabel("Přidat odkaz na externí fotogalerii").check();
    const url = gallery.getByLabel("Adresa galerie");
    for (const variant of ["svg", "lzi", "velky", "bomba", "presmerovani"]) {
      const target = `${OG_BASE}/galerie-${variant}?t=${site.tag}-${variant}`;
      await url.fill(target);
      await url.blur();
      // karta se načetla (titulek podle varianty), ale obrázek ne
      await expect(gallery).toContainText(`Galerie bez obrázku (${variant})`);
    }
    expect(
      (await mediaRows(site.weddingId)).filter((r) => r.kind === "card" && r.status === "ready"),
    ).toEqual([]);
  });
});
