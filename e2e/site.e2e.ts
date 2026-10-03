import { expect, test, type Page } from "@playwright/test";
import { HOSTS, pageUrl } from "./hosts";
import { TEMPLATES, VIEWPORTS, previewUrl, type Lang, type Template } from "./site";

/** Vykreslení webu páru: odkazy, jazyky, klávesnice, reflow, režim poděkování a dary za PINem. */

const NAV = "Navigace po stránce";

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe("web páru na hostiteli webu páru", () => {
  test("česky: jména, bloky, navigace a hlavičky bez indexace", async ({ page }) => {
    const response = await page.goto(pageUrl(HOSTS.tenant, "/"));
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Klára & Matěj");
    await expect(page).toHaveTitle("Klára a Matěj");
    const nav = page.getByRole("navigation", { name: NAV });
    for (const name of ["Program", "Místo", "Ubytování", "Otázky", "Kontakt", "Dary"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    await expect(page.getByText("Do svatby zbývá")).toBeVisible();
  });

  test("hreflang pro jazyky webu, bez indexace", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.tenant, "/"));
    const alternates = await page
      .locator('link[rel="alternate"][hreflang]')
      .evaluateAll((els) =>
        Object.fromEntries(els.map((el) => [el.getAttribute("hreflang"), el.getAttribute("href")])),
      );
    expect(alternates).toEqual({
      cs: expect.stringMatching(/^http:\/\/klara-a-matej\.localhost:\d+\/$/),
      en: expect.stringMatching(/^http:\/\/klara-a-matej\.localhost:\d+\/en$/),
      "x-default": expect.stringMatching(/^http:\/\/klara-a-matej\.localhost:\d+\/$/),
    });
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
  });

  test("přepínač jazyka vede na anglickou verzi a zpět", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.tenant, "/"));
    await page
      .getByRole("navigation", { name: "Jazyk" })
      .getByRole("link", { name: "English" })
      .click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await expect(page.getByRole("heading", { name: "Programme" })).toBeVisible();
    await expect(page).toHaveTitle("Klára and Matěj");
    await page
      .getByRole("navigation", { name: "Language" })
      .getByRole("link", { name: "Čeština" })
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");
  });

  test("web nevolá žádné třetí strany (soukromí hostů)", async ({ page }) => {
    const origins = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http")) origins.add(url.origin);
    });
    await page.goto(pageUrl(HOSTS.tenant, "/"), { waitUntil: "networkidle" });
    const own = new URL(pageUrl(HOSTS.tenant, "/")).origin;
    expect([...origins].filter((origin) => origin !== own)).toEqual([]);
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("mapa místa je z dlaždic vlastního původu, odkazy vedou do Google Maps a Mapy.cz", async ({
    page,
  }) => {
    await page.goto(pageUrl(HOSTS.tenant, "/"));
    const venue = page.locator("#misto");
    await expect(venue.getByRole("img", { name: /Mapa místa konání/ })).toBeVisible();
    const src = await venue.locator(".site-map img").first().getAttribute("src");
    expect(src).toMatch(/^\/api\/map-tile\/\d+\/\d+\/\d+$/);
    const tile = await page.request.get(new URL(src!, page.url()).toString());
    expect(tile.status()).toBe(200);
    expect(tile.headers()["content-type"]).toBe("image/png");
    expect(tile.headers()["cache-control"]).toContain("s-maxage");
    const invalid = await page.request.get(new URL("/api/map-tile/17/0/0", page.url()).toString());
    expect(invalid.status()).toBe(404);
    await expect(venue.getByRole("link", { name: /Mapy\.cz/ }).first()).toHaveAttribute(
      "href",
      /^https:\/\//,
    );
  });

  test("mapa je jen odkaz, textová adresa je vždy", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.tenant, "/"));
    const venue = page.locator("#misto");
    await expect(venue.getByText("Zámecká 1, 252 01 Dobřichovice").first()).toBeVisible();
    await expect(venue.getByRole("link", { name: /Zobrazit na mapě/ })).toHaveAttribute(
      "href",
      /^https:\/\//,
    );
  });
});

test.describe("klávesnice", () => {
  test("odkaz v navigaci přejde na kotvu a další Tab pokračuje v sekci", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.tenant, "/"));
    const link = page.getByRole("navigation", { name: NAV }).getByRole("link", { name: "Místo" });
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#misto$/);
    await expect(page.locator("#misto")).toBeInViewport();
    await page.keyboard.press("Tab");
    const insideSection = await page.evaluate(
      () => document.activeElement?.closest("#misto") !== null,
    );
    expect(insideSection).toBe(true);
  });

  test("všechny kotvy z navigace vedou na existující sekci", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.tenant, "/"));
    const hrefs = await page
      .getByRole("navigation", { name: NAV })
      .getByRole("link")
      .evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThanOrEqual(8);
    for (const href of hrefs) {
      expect(href).toMatch(/^#/);
      await expect(page.locator(href)).toHaveCount(1);
    }
  });

  test("FAQ se ovládá Enterem a mezerníkem", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.tenant, "/"));
    const summary = page.locator("#otazky summary").first();
    const details = page.locator("#otazky details").first();
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveJSProperty("open", true);
    await page.keyboard.press("Space");
    await expect(details).toHaveJSProperty("open", false);
  });

  test("ukotvené tlačítko nezakrývá žádný zaměřený prvek (WCAG 2.4.11)", async ({ browser }) => {
    // Hladké posouvání vypnuto, aby se obdélníky měřily po dokončení posunu.
    const context = await browser.newContext({
      viewport: VIEWPORTS.mobil,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(previewUrl("cs", { template: "eukalyptus", unlocked: true }));
    const bar = page.getByRole("complementary", { name: "Rychlý odkaz na potvrzení účasti" });
    await expect(bar).toBeVisible();

    let steps = 0;
    for (;;) {
      await page.keyboard.press("Tab");
      steps++;
      const result = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const stickyEl = document.querySelector(".site-sticky");
        if (!active || !stickyEl || active === document.body) return null;
        const a = active.getBoundingClientRect();
        const s = stickyEl.getBoundingClientRect();
        return {
          inside: stickyEl.contains(active),
          text: active.textContent?.trim().slice(0, 40),
          covered: a.bottom > s.top && a.top < s.bottom && a.right > s.left && a.left < s.right,
          visible: a.top >= 0 && a.bottom <= window.innerHeight,
        };
      });
      if (!result) continue;
      if (result.inside) break;
      expect(result.covered, `zakryto: ${result.text}`).toBe(false);
      expect(result.visible, `mimo obrazovku: ${result.text}`).toBe(true);
      expect(steps).toBeLessThan(80);
    }
    expect(steps).toBeGreaterThan(15);
    await context.close();
  });

  test("ukotvené tlačítko vede na sekci Potvrdit účast", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.tenant, "/"));
    await page
      .getByRole("complementary", { name: "Rychlý odkaz na potvrzení účasti" })
      .getByRole("link", { name: "Potvrdit účast" })
      .click();
    await expect(page).toHaveURL(/#potvrdit-ucast$/);
    await expect(page.locator("#potvrdit-ucast")).toBeInViewport();
  });
});

test.describe("reflow a zvětšení (WCAG 1.4.10)", () => {
  // 320 × 256 CSS px odpovídá zvětšení 400 % na obrazovce 1280 px.
  for (const lang of ["cs", "en"] as Lang[]) {
    for (const template of Object.keys(TEMPLATES) as Template[]) {
      test(`${template}, ${lang}: bez vodorovného posunu při 400 %`, async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 256 });
        for (const palette of TEMPLATES[template]) {
          await page.goto(previewUrl(lang, { template, palette, unlocked: true }));
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          // Rozbalená FAQ jsou nejdelší text.
          for (const summary of await page.locator("summary").all()) await summary.click();
          expect(await horizontalOverflow(page), `${template}/${palette}`).toBeLessThanOrEqual(0);
        }
      });
    }
  }

  test("text zůstane čitelný při zvětšení písma na 200 %", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobil);
    await page.goto(previewUrl("cs", { template: "chateau" }));
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("režim poděkování po svatbě (FR-WEB-4)", () => {
  test("odpočet a potvrzení účasti zmizí, dary se skryjí, galerie zůstane", async ({ page }) => {
    await page.goto(previewUrl("cs", { phase: "thanks", unlocked: true }));
    await expect(page.getByText("Do svatby zbývá")).toHaveCount(0);
    await expect(page.locator("#potvrdit-ucast")).toHaveCount(0);
    await expect(page.locator(".site-sticky")).toHaveCount(0);
    await expect(page.locator("#dary")).toHaveCount(0);
    await expect(page.getByText("19-2000145399/0800")).toHaveCount(0);
    await expect(page.locator("#galerie img")).toHaveCount(3);
    await expect(page.getByText("Děkujeme, že jste byli s námi").first()).toBeVisible();
  });

  test("před svatbou je odpočet, potvrzení účasti i dary", async ({ page }) => {
    await page.goto(previewUrl("cs", { phase: "rsvp_open" }));
    await expect(page.getByText(/Do svatby zbývá/)).toBeVisible();
    await expect(page.locator("#potvrdit-ucast")).toHaveCount(1);
    await expect(page.locator("#dary")).toHaveCount(1);
  });
});

test.describe("dary a soukromé místo za PINem (FR-PRIV-2)", () => {
  test("zamčené: jen formuláře PINu, číslo účtu ani adresa soukromého místa nejsou v HTML", async ({
    page,
  }) => {
    await page.goto(previewUrl("cs"));
    await expect(page.locator("#dary").getByLabel("PIN z pozvánky")).toBeVisible();
    await expect(page.locator("#misto").getByLabel("PIN z pozvánky")).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain("19-2000145399");
    expect(html).not.toContain("CZ6508000000192000145399");
    expect(html).not.toContain("Altánová 7");
    await expect(page.locator("svg.site-qr")).toHaveCount(0);
  });

  test("odemčené: číslo účtu a QR platba s popiskem a adresa soukromého místa", async ({
    page,
  }) => {
    await page.goto(previewUrl("cs", { unlocked: true }));
    await expect(page.getByText("19-2000145399/0800")).toBeVisible();
    await expect(
      page.getByRole("img", { name: /QR kód pro platbu na účet 19-2000145399\/0800/ }),
    ).toBeVisible();
    await expect(page.getByText("Altánová 7, 252 01 Dobřichovice")).toBeVisible();
    await expect(page.getByLabel("PIN z pozvánky")).toHaveCount(0);
  });
});

test.describe("šablony mění jen tokeny, typografii a kompozici", () => {
  test("každá šablona a paleta nese svou barvu pozadí a stejné bloky", async ({ page }) => {
    const expected: Record<string, string> = {
      "editorial/papir": "rgb(251, 250, 247)",
      "eukalyptus/stribrna": "rgb(238, 243, 239)",
      "eukalyptus/hloubka": "rgb(34, 58, 52)",
      "eukalyptus/pudr": "rgb(244, 241, 236)",
      "chateau/champagne": "rgb(251, 246, 236)",
      "modern/limeta": "rgb(13, 15, 18)",
    };
    for (const [key, background] of Object.entries(expected)) {
      const [template, palette] = key.split("/") as [Template, string];
      await page.goto(previewUrl("cs", { template, palette }));
      await expect(page.locator(".site-root")).toHaveCSS("background-color", background);
      await expect(page.locator("main > section")).toHaveCount(11);
    }
  });

  test("typografie jmen: Editorial tenký, Modern tučný, Chateau verzálky", async ({ page }) => {
    await page.goto(previewUrl("cs", { template: "editorial" }));
    await expect(page.locator(".site-names")).toHaveCSS("font-weight", "300");
    await page.goto(previewUrl("cs", { template: "modern" }));
    await expect(page.locator(".site-names")).toHaveCSS("font-weight", "800");
    await page.goto(previewUrl("cs", { template: "chateau" }));
    await expect(page.locator(".site-names")).toHaveCSS("text-transform", "uppercase");
  });

  test("Eukalyptus má SVG listy jako dekor pod textem, ostatní šablony ne", async ({ page }) => {
    await page.goto(previewUrl("cs", { template: "eukalyptus" }));
    await expect(page.locator(".site-leaves")).toHaveCount(2);
    await expect(page.locator(".site-leaves").first()).toHaveAttribute("aria-hidden", "true");
    await page.goto(previewUrl("cs", { template: "editorial" }));
    await expect(page.locator(".site-leaves")).toHaveCount(0);
  });

  test("Modern: animace jmen jen bez prefers-reduced-motion", async ({ browser }) => {
    const normal = await browser.newContext();
    const p1 = await normal.newPage();
    await p1.goto(previewUrl("cs", { template: "modern" }));
    await expect(p1.locator(".site-names")).toHaveCSS("animation-name", "site-rise");
    await normal.close();

    const reduced = await browser.newContext({ reducedMotion: "reduce" });
    const p2 = await reduced.newPage();
    await p2.goto(previewUrl("cs", { template: "modern" }));
    await expect(p2.locator(".site-names")).toHaveCSS("animation-name", "none");
    await reduced.close();
  });
});

test.describe("vývojový náhled", () => {
  test("přepínání šablon odkazy a zachování jazyka", async ({ page }) => {
    await page.goto(previewUrl("en"));
    await page
      .getByRole("navigation", { name: "Preview settings" })
      .getByRole("link", { name: "Modern" })
      .click();
    await expect(page).toHaveURL(/\/en\/site-preview\?.*template=modern/);
    await expect(page.locator(".site-root")).toHaveAttribute("data-template", "modern");
  });

  test("neplatné hodnoty v adrese padají na výchozí, ne na chybu", async ({ page }) => {
    const response = await page.goto(
      pageUrl(HOSTS.marketing, "/site-preview?template=neon&palette=x&phase=y&fixture=z"),
    );
    expect(response?.status()).toBe(200);
    await expect(page.locator(".site-root")).toHaveAttribute("data-template", "eukalyptus");
  });
});

test.describe("skutečný web páru: reflow a omezený pohyb", () => {
  for (const [lang, path] of [
    ["cs", "/"],
    ["en", "/en"],
  ] as const) {
    test(`reflow při 320 px (400 % zvětšení), ${lang}: bez vodorovného posunu`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 256 });
      await page.goto(pageUrl(HOSTS.tenant, path));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      for (const summary of await page.locator("summary").all()) await summary.click();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("prefers-reduced-motion: žádné animace ani plynulé posouvání na webu páru", async ({
    browser,
  }) => {
    const motion = async (reducedMotion: "reduce" | "no-preference") => {
      const context = await browser.newContext({ reducedMotion });
      const page = await context.newPage();
      await page.goto(pageUrl(HOSTS.tenant, "/"));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const result = await page.evaluate(() => {
        const seconds = (value: string) =>
          Math.max(...value.split(",").map((part) => parseFloat(part) || 0));
        const moving: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("body, body *")) {
          const style = getComputedStyle(el);
          const animated =
            style.animationName !== "none" && seconds(style.animationDuration) > 0.01;
          const transitioned = seconds(style.transitionDuration) > 0.01;
          if (animated || transitioned) moving.push(`${el.tagName}.${el.className}`);
        }
        return {
          moving,
          scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        };
      });
      await context.close();
      return result;
    };
    const reduced = await motion("reduce");
    expect(reduced.moving).toEqual([]);
    expect(reduced.scrollBehavior).toBe("auto");
  });
});
