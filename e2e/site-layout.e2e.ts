import { expect, test } from "@playwright/test";
import { previewUrl } from "./site";

/**
 * Vzhled „Tiskovina“ klasických šablon (Editorial, Chateau, Modern) na počítači i mobilu (projekty e2e
 * a e2e-mobile): pruh Kdy / Kde / Odpověď pod jmény, číslované sekce (nadpis vlevo a obsah vpravo jen na
 * širokém displeji), navigace v jednom řádku a žádné vodorovné posouvání stránky.
 */

const CLASSIC = ["editorial", "chateau", "modern"] as const;

for (const template of CLASSIC) {
  test(`${template}: pruh pod jmény, čísla sekcí a rozložení podle šířky`, async ({ page }) => {
    await page.goto(previewUrl("cs", { template }));
    const hero = page.locator(".site-hero");
    const facts = hero.locator("dl.site-hero-facts");
    await expect(facts).toBeVisible();
    await expect(facts.locator("dt")).toHaveText(["Kdy", "Kde", "Odpověď"]);
    await expect(facts).toContainText(/19.\s?června 2027/);
    await expect(facts).toContainText(/od\s\d{2}:\d{2}/);
    // odkaz z pruhu vede na formulář odpovědi
    await facts.getByRole("link", { name: "Potvrdit účast" }).click();
    await expect(page).toHaveURL(/#potvrdit-ucast$/);
    await expect(page.locator("#potvrdit-ucast")).toBeInViewport();

    // čísla sekcí 01, 02… jsou jen dekor
    const firstNo = page.locator(".site-section-no").first();
    await expect(firstNo).toHaveAttribute("aria-hidden", "true");
    // text čísla dodá čítač CSS (prohlížeč vrací výraz, ne výsledek); počet čísel = počet sekcí
    expect(await firstNo.evaluate((el) => getComputedStyle(el, "::before").content)).toContain(
      "counter(site-section",
    );
    await expect(page.locator(".site-section-no")).toHaveCount(
      await page.locator(".site-section").count(),
    );

    // nadpis vlevo a obsah vpravo jen na širokém displeji, jinak pod sebou
    const section = page.locator("#nas-pribeh, .site-section").first();
    const head = (await section.locator(".site-section-head").boundingBox())!;
    const body = (await section.locator(".site-section-body").boundingBox())!;
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    if (wide) {
      expect(body.x).toBeGreaterThan(head.x + head.width);
    } else {
      // pod sebou: obsah začíná na stejném levém okraji jako nadpis (ozdoba může mít záporný okraj)
      expect(Math.abs(body.x - head.x)).toBeLessThan(2);
      expect(body.y).toBeGreaterThan(head.y);
    }

    // stránka se do strany neposouvá, navigace je v jednom řádku
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
    const navHeight = await page
      .locator(".site-header .site-nav")
      .evaluate((el) => el.clientHeight);
    expect(navHeight).toBeLessThan(70);
  });
}

for (const lang of ["cs", "en"] as const) {
  for (const template of CLASSIC) {
    test(`${template}, ${lang}: nadpisy sekcí se vejdou do svého sloupce`, async ({ page }) => {
      await page.goto(previewUrl(lang, { template }));
      const overflowing = await page
        .locator(".site-section-head .site-h2")
        .evaluateAll((headings) =>
          headings.filter((h) => h.scrollWidth > h.clientWidth + 1).map((h) => h.textContent ?? ""),
        );
      expect(overflowing).toEqual([]);
    });
  }
}

test("anglicky: pruh pod jmény v angličtině", async ({ page }) => {
  await page.goto(previewUrl("en", { template: "editorial" }));
  await expect(page.locator("dl.site-hero-facts dt")).toHaveText(["When", "Where", "Reply"]);
  await expect(page.locator("dl.site-hero-facts")).toContainText(/from\s\d{2}:\d{2}/);
});
