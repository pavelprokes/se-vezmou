import type { APIRequestContext, Page } from "@playwright/test";
import { testimonials } from "../src/config/testimonials";
import { NBSP } from "../src/i18n/typo";
import { HOSTS, PORT, apiRequest, pageUrl } from "./hosts";
// `test` z podpory přihlášení dává každému testu vlastní IP (čítače omezení se nesdílejí).
import { uniqueTag, withDb } from "./support/db";
import { expect, test } from "./support/fixtures";
import { linkOf, waitForMail } from "./support/mail";

/**
 * Úvodní stránka (M2) v češtině i angličtině. Běží v desktopovém i mobilním viewportu
 * (projekty `e2e` a `e2e-mobile`). Zdrojové HTML se čte bez JavaScriptu (`request`).
 */

// Plynulé posouvání (`scroll-behavior: smooth`) by klikání na prvky mimo obraz zbytečně zdržovalo
// a dělalo testy nestabilní; animace samotné ověřuje test `prefers-reduced-motion` níže.
test.use({ reducedMotion: "reduce" });

const locales = [
  { code: "cs", path: "/", lang: "cs", h1: /^Vaše svatba\./, canonical: "https://se-vezmou.cz" },
  {
    code: "en",
    path: "/en",
    lang: "en-GB",
    h1: /^Your wedding\./,
    canonical: "https://se-vezmou.cz/en",
  },
] as const;

async function source(request: APIRequestContext, path: string) {
  const { url, options } = apiRequest(HOSTS.marketing, path);
  const response = await request.get(url, options);
  return { response, html: await response.text() };
}

interface JsonLdGraph {
  "@context": string;
  "@graph": Record<string, unknown>[];
}

function jsonLd(html: string): JsonLdGraph[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1]) as JsonLdGraph,
  );
}

/** Na mobilu je navigace za tlačítkem Nabídka; na desktopu je vždy vidět. */
async function openMenuIfCollapsed(page: Page, isMobile: boolean) {
  if (!isMobile) return;
  const button = page.getByRole("button", { name: /^(Nabídka|Menu)$/ });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

for (const locale of locales) {
  test.describe(`úvodní stránka ${locale.code}: zdrojové HTML bez JavaScriptu`, () => {
    test("jeden h1, celý text sekcí a hierarchie nadpisů", async ({ request }) => {
      const { response, html } = await source(request, locale.path);
      expect(response.status()).toBe(200);
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
      expect(html).toContain(`<html lang="${locale.lang}"`);
      // Sekce jsou v HTML už při první odpovědi: patnáct oblastí (14 sekcí a patička).
      expect(html.match(/<section[\s>]/g)?.length).toBeGreaterThanOrEqual(14);
      expect(html.match(/<h2[\s>]/g)).toHaveLength(13);
      expect(html).toContain("<footer");
    });

    test("FAQ: šest otázek a odpovědí v HTML, rozbalovací přes <details>", async ({ request }) => {
      const { html } = await source(request, locale.path);
      expect(html.match(/<details[\s>]/g)).toHaveLength(6);
      expect(html.match(/<summary[\s>]/g)).toHaveLength(6);
      // Žádné zástupné texty v hranatých závorkách (podmínky, datum a místo v ukázkách).
      expect(html).not.toMatch(/\[(PODMÍNKY|TERMS|DD[^\]]*|místo|venue)\]/);
    });

    test("JSON-LD: Organization, WebSite, SoftwareApplication, FAQPage a BreadcrumbList", async ({
      request,
    }) => {
      const { html } = await source(request, locale.path);
      const documents = jsonLd(html);
      expect(documents).toHaveLength(1);
      const nodes = documents[0]["@graph"];
      expect(documents[0]["@context"]).toBe("https://schema.org");
      expect(nodes.map((node) => node["@type"]).sort()).toEqual([
        "BreadcrumbList",
        "FAQPage",
        "Organization",
        "SoftwareApplication",
        "WebSite",
      ]);

      const app = nodes.find((node) => node["@type"] === "SoftwareApplication");
      expect(app?.offers).toMatchObject({ price: "0", priceCurrency: "CZK" });
      expect(app?.offers).not.toHaveProperty("priceValidUntil");

      const faq = nodes.find((node) => node["@type"] === "FAQPage") as {
        mainEntity: { name: string }[];
      };
      expect(faq.mainEntity).toHaveLength(6);

      // Žádné recenze ve strukturovaných datech (skutečné reference zatím nejsou).
      expect(JSON.stringify(documents)).not.toContain('"Review"');
      expect(JSON.stringify(documents)).not.toContain("AggregateRating");
      // Kontakt provozovatele je ve značkách, zástupné texty ne.
      expect(JSON.stringify(documents)).toContain("info@se-vezmou.cz");
      expect(JSON.stringify(documents)).not.toContain("[KONTAKT]");
    });

    test("hreflang cs, en a x-default, canonical na sebe, bez noindex", async ({ request }) => {
      const { response, html } = await source(request, locale.path);
      expect(response.headers()["x-robots-tag"]).toBeUndefined();
      expect(html).not.toMatch(/<meta name="robots"[^>]*noindex/);
      const link = (hreflang: string) =>
        new RegExp(`<link rel="alternate" hreflang="${hreflang}" href="([^"]+)"`, "i").exec(
          html,
        )?.[1];
      expect(link("cs")).toBe("https://se-vezmou.cz");
      expect(link("en")).toBe("https://se-vezmou.cz/en");
      expect(link("x-default")).toBe("https://se-vezmou.cz");
      expect(new RegExp(`<link rel="canonical" href="${locale.canonical}"`).test(html)).toBe(true);
    });

    test("Open Graph a Twitter karta s obrázkem 1200 × 630", async ({ request }) => {
      const { html } = await source(request, locale.path);
      expect(html).toContain('property="og:type" content="website"');
      expect(html).toContain(
        `property="og:image" content="https://se-vezmou.cz/og/se-vezmou-${locale.code}.png"`,
      );
      expect(html).toContain('property="og:image:width" content="1200"');
      expect(html).toContain('name="twitter:card" content="summary_large_image"');
      expect(html).toMatch(/property="og:locale" content="(cs_CZ|en_GB)"/);
      const { url, options } = apiRequest(HOSTS.marketing, `/og/se-vezmou-${locale.code}.png`);
      const image = await request.get(url, options);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/png");
    });
  });

  test.describe(`úvodní stránka ${locale.code}: obsah a ovládání`, () => {
    test("hero: nadpis, jména s živým náhledem webu a přepínač šablon", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      await expect(page.locator("html")).toHaveAttribute("lang", locale.lang);
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText(locale.h1);

      const hero = page.locator("section[aria-labelledby='hero-title']");
      const preview = hero.getByTestId("address-preview");
      await expect(preview).toHaveText(
        locale.code === "cs" ? "klara-a-matej.se-vezmou.cz" : "emma-and-thomas.se-vezmou.cz",
      );
      await hero
        .getByLabel(locale.code === "cs" ? "První jméno" : "Your name", { exact: true })
        .fill("Šárka");
      await hero
        .getByLabel(locale.code === "cs" ? "Druhé jméno" : "Your partner’s name")
        .fill("Ondřej");
      await expect(preview).toHaveText(
        locale.code === "cs" ? "sarka-a-ondrej.se-vezmou.cz" : "sarka-and-ondrej.se-vezmou.cz",
      );

      const templates = hero.getByRole("group", {
        name: locale.code === "cs" ? "Šablona náhledu" : "Preview template",
      });
      await expect(templates.getByRole("button")).toHaveCount(4);
      await expect(templates.getByRole("button", { name: "Editorial" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const modern = templates.getByRole("button", { name: "Modern" });
      await modern.click();
      await expect(modern).toHaveAttribute("aria-pressed", "true");
      await expect(templates.getByRole("button", { name: "Editorial" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    test("hero: formulář jmen předvyplní průvodce", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const hero = page.locator("section[aria-labelledby='hero-title']");
      await hero
        .getByLabel(locale.code === "cs" ? "První jméno" : "Your name", { exact: true })
        .fill("Šárka");
      await hero
        .getByRole("button", { name: locale.code === "cs" ? "Vytvořit web" : "Create your site" })
        .click();
      await page.waitForURL(/\/vytvorit\?/);
      const url = new URL(page.url());
      expect(url.searchParams.get("jmeno1")).toBe("Šárka");
      expect(url.searchParams.get("jazyk")).toBe(locale.code);
    });

    test("sekce jsou v zadaném pořadí", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const ids = await page
        .locator("main > section")
        .evaluateAll((sections) =>
          sections.map((section) => section.getAttribute("aria-labelledby")),
        );
      expect(ids).toEqual([
        "hero-title",
        "intro-title",
        "problem-title",
        "steps-title",
        "templates-title",
        "features-title",
        "after-title",
        "trust-title",
        "pricing-title",
        "facts-title",
        "about-title",
        "news-title",
        "faq-title",
        "cta-title",
      ]);
      // Poslední oblast je patička.
      await expect(page.locator("footer")).toHaveCount(1);
    });

    test("cena: jedna karta 0 Kč a nikdy „zdarma navždy“", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const pricing = page.locator("#pricing");
      const prices = await pricing.locator("li > div > p").allInnerTexts();
      expect(prices).toHaveLength(1);
      for (const price of prices) expect(price).toMatch(/0/);
      const text = (await page.locator("main").innerText()).toLowerCase();
      expect(text).not.toMatch(/navždy|\bforever\b|\bfor ever\b/);
      await expect(pricing).not.toContainText("[");
    });

    test("sekce novinek a kontaktu nemá zástupné texty ani vymyšlené recenze", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const news = page.locator("#news");
      await expect(news.locator("blockquote")).toHaveCount(0);
      await expect(news.getByText(/\[.*\]|Zástupný text|Placeholder text/)).toHaveCount(0);
      await expect(news.locator("#waitlist form")).toBeVisible();
      // Reference jen ze skutečných recenzí v konfiguraci; prázdný seznam = žádná sekce.
      await expect(page.locator("#reference")).toHaveCount(testimonials.length === 0 ? 0 : 1);
    });

    test("čím se lišíme: osm bodů pod funkcemi", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const extra = page.locator("#features li").filter({
        has: page.getByRole("heading", { name: /^(Čím se lišíme|What sets us apart)$/ }),
      });
      await expect(extra.locator("ul > li")).toHaveCount(8);
      await expect(extra).toContainText(/EPC/);
      await extra.scrollIntoViewIfNeeded();
      await extra.screenshot({ path: test.info().outputPath(`cim-se-lisime-${locale.code}.png`) });
    });

    test("šablony: osm skutečných snímků se jmény ukázkového páru", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const previews = page.locator("#templates img");
      await expect(previews).toHaveCount(8);
      for (const name of [
        "Editorial",
        locale.code === "cs" ? "Eukalyptus" : "Eucalyptus",
        "Chateau",
        "Modern",
        locale.code === "cs" ? "Statek" : "Farmstead",
        locale.code === "cs" ? "Vinice" : "Vineyard",
        locale.code === "cs" ? "Louka" : "Meadow",
        "Deco",
      ]) {
        await expect(
          page.locator("#templates").getByRole("img", { name: new RegExp(name) }),
        ).toBeVisible();
      }
    });

    test("FAQ: otázka se rozbalí myší i klávesnicí", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const items = page.locator("#faq details");
      await expect(items).toHaveCount(6);
      const first = items.first();
      await expect(first).not.toHaveAttribute("open", "");
      await first.locator("summary").click();
      await expect(first).toHaveAttribute("open", "");

      const second = items.nth(1);
      await second.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(second).toHaveAttribute("open", "");
      await page.keyboard.press("Enter");
      await expect(second).not.toHaveAttribute("open", "");
    });

    test("pole jmen v závěrečné výzvě předvyplní průvodce (query parametry)", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const form = page.locator("#start form");
      await form
        .getByLabel(locale.code === "cs" ? "První jméno" : "Your name", { exact: true })
        .fill("Anna");
      await form
        .getByLabel(locale.code === "cs" ? "Druhé jméno" : "Your partner’s name")
        .fill("Jiří Novák");
      await form.getByRole("button").click();
      await page.waitForURL(/\/vytvorit\?/);
      const url = new URL(page.url());
      expect(url.origin).toBe(`http://app.localhost:${PORT}`);
      // Anglická varianta průvodce je pod /en (formulář tam vede rovnou).
      expect(url.pathname).toBe(locale.code === "cs" ? "/vytvorit" : "/en/vytvorit");
      expect(url.searchParams.get("jmeno1")).toBe("Anna");
      expect(url.searchParams.get("jmeno2")).toBe("Jiří Novák");
      expect(url.searchParams.get("jazyk")).toBe(locale.code);
    });

    test("hlavní výzvy vedou na adresu průvodce z konfigurace", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const hrefs = await page
        .locator('a[href*="/vytvorit"]')
        .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      // Hlavička a cena; hero a závěrečná výzva jsou formuláře jmen (GET na průvodce).
      expect(hrefs.length).toBeGreaterThanOrEqual(2);
      // Průvodce v jiném než výchozím jazyce je pod předponou jazyka (ADR 0013).
      const path = locale.code === "cs" ? "/vytvorit" : `/${locale.code}/vytvorit`;
      for (const href of hrefs) {
        expect(href).toBe(`http://app.localhost:${PORT}${path}?jazyk=${locale.code}`);
      }
      const actions = await page
        .locator("main form[method='get']")
        .evaluateAll((forms) => forms.map((form) => form.getAttribute("action")));
      expect(actions).toEqual([
        `http://app.localhost:${PORT}${path}`,
        `http://app.localhost:${PORT}${path}`,
      ]);
    });

    test("navigace: odkazy na sekce, přepínač jazyka a mobilní nabídka klávesnicí", async ({
      page,
      isMobile,
    }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const menuName = /^(Nabídka|Menu)$/;
      if (isMobile) {
        const button = page.getByRole("button", { name: menuName });
        await expect(button).toHaveAttribute("aria-expanded", "false");
        await expect(
          page.getByRole("navigation", { name: /Hlavní navigace|Main navigation/ }),
        ).toBeHidden();
        await button.focus();
        await page.keyboard.press("Enter");
        await expect(button).toHaveAttribute("aria-expanded", "true");
        const controls = await button.getAttribute("aria-controls");
        await expect(page.locator(`[id="${controls}"]`)).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(button).toHaveAttribute("aria-expanded", "false");
        await expect(button).toBeFocused();
      }
      await openMenuIfCollapsed(page, isMobile);
      const nav = page.getByRole("navigation", { name: /Hlavní navigace|Main navigation/ });
      await expect(nav.getByRole("link")).toHaveCount(5);
      await nav.getByRole("link").nth(3).click();
      await expect(page).toHaveURL(
        locale.code === "cs" ? /\/dvojjazycny-svatebni-web$/ : /\/en\/bilingual-wedding-website$/,
      );
      // Šablony a cena mají vlastní stránky.
      await openMenuIfCollapsed(page, isMobile);
      await nav.getByRole("link").nth(2).click();
      await expect(page).toHaveURL(locale.code === "cs" ? /\/cenik$/ : /\/en\/pricing$/);
      // Poslední odkaz vede na blog.
      await openMenuIfCollapsed(page, isMobile);
      await nav.getByRole("link").nth(4).click();
      await expect(page).toHaveURL(locale.code === "cs" ? /\/blog$/ : /\/en\/blog$/);
    });

    test("přepínač jazyka vede na druhou verzi stránky", async ({ page, isMobile }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      await openMenuIfCollapsed(page, isMobile);
      const other = locale.code === "cs" ? "EN" : "CS";
      const switcher = page.locator("header nav").last();
      await switcher.getByRole("link", { name: new RegExp(`^${other}`) }).click();
      await expect(page).toHaveURL(pageUrl(HOSTS.marketing, locale.code === "cs" ? "/en" : "/"));
    });

    test("typografie: jednopísmenná předložka nese nezlomitelnou mezeru", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const lead = await page
        .locator("main p", { hasText: /praktické|practical/ })
        .first()
        .innerText();
      if (locale.code === "cs") expect(lead).toContain(`i${NBSP}praktické`);
      else expect(lead).toContain("practical");
    });

    test("patička: provozovatel (svatební fotograf) a kontakt", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const footer = page.locator("footer");
      await expect(footer).toContainText("Pavel Prokeš, IČO 87877601");
      await expect(footer).toContainText(
        locale.code === "cs" ? "svatební fotograf" : "wedding photographer",
      );
      await expect(footer).toContainText("info@se-vezmou.cz");
    });
  });

  test.describe(`newsletter ${locale.code}`, () => {
    const labels =
      locale.code === "cs"
        ? {
            email: "E-mail",
            submit: "Odebírat novinky",
            consent: /Souhlasím/,
            success: /Klikněte\sv\sněm\sna\sodkaz/,
            required: "Vyplňte e-mail.",
            invalid: /Zkontrolujte e-mail/,
            noConsent: /Bez souhlasu/,
          }
        : {
            email: "Email",
            submit: "Subscribe to news",
            consent: /I agree/,
            success: /Click\sthe\slink\sin\sit/,
            required: "Enter your email.",
            invalid: /Check your email/,
            noConsent: /without your consent/,
          };

    test("platný e-mail a souhlas: přístupné potvrzení v živé oblasti", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const form = page.locator("#waitlist form");
      await form.getByLabel(labels.email, { exact: true }).fill("Par@Example.com");
      await form.getByLabel(labels.consent).check();
      await form.getByRole("button", { name: labels.submit }).click();
      const status = form.getByRole("status");
      await expect(status).toContainText(labels.success);
      await expect(status).toHaveAttribute("aria-live", "polite");
    });

    test("e-mail se uloží do databáze a stejný e-mail podruhé dá stejnou odpověď", async ({
      page,
    }) => {
      const tag = uniqueTag();
      const address = `Cekani-${tag}@Example.Test`;
      const submit = async () => {
        await page.goto(pageUrl(HOSTS.marketing, locale.path));
        const form = page.locator("#waitlist form");
        await form.getByLabel(labels.email, { exact: true }).fill(address);
        await form.getByLabel(labels.consent).check();
        await form.getByRole("button", { name: labels.submit }).click();
        await expect(form.getByRole("status")).toContainText(labels.success);
        return form.getByRole("status").innerText();
      };
      const first = await submit();
      const rows = async () =>
        withDb(
          async (db) =>
            (
              await db.query<{
                email: string;
                locale: string;
                consent_text_version: string;
                consent_at: Date;
              }>(
                "select email::text, locale, consent_text_version, consent_at from se_vezmou.waitlist where email = $1",
                [address.toLowerCase()],
              )
            ).rows,
        );
      const [stored] = await rows();
      expect(stored).toMatchObject({
        email: address.toLowerCase(),
        locale: locale.code,
        consent_text_version: "2026-10-v2",
      });

      // Opakování: žádné prozrazení, odpověď i záznam zůstávají stejné.
      const second = await submit();
      expect(second).toBe(first);
      const after = await rows();
      expect(after).toHaveLength(1);
      expect(after[0].consent_at).toEqual(stored.consent_at);
    });

    test("double opt-in: odkaz z e-mailu otevře stránku a zápis potvrdí až tlačítko", async ({
      page,
    }) => {
      const address = `potvrzeni-${uniqueTag()}@example.test`;
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const form = page.locator("#waitlist form");
      await form.getByLabel(labels.email, { exact: true }).fill(address);
      await form.getByLabel(labels.consent).check();
      await form.getByRole("button", { name: labels.submit }).click();
      await expect(form.getByRole("status")).toContainText(labels.success);

      const link = new URL(linkOf(await waitForMail(address)));
      const confirmed = async () =>
        withDb(
          async (db) =>
            (
              await db.query<{ confirmed: boolean }>(
                "select confirmed_at is not null as confirmed from se_vezmou.waitlist where email = $1",
                [address],
              )
            ).rows[0]?.confirmed,
        );
      // samotné otevření odkazu (jako skener pošty) nic nepotvrdí
      await page.goto(pageUrl(HOSTS.marketing, `${link.pathname}${link.search}`));
      expect(await confirmed()).toBe(false);
      // přepínač jazyka si token ponese (druhá jazyková verze ví, co potvrdit)
      const other = page.locator('a[hreflang]:not([aria-current="true"])').first();
      await expect(other).toHaveAttribute(
        "href",
        new RegExp(`\\?t=${link.searchParams.get("t")}$`),
      );
      await page
        .getByRole("button", {
          name: locale.code === "cs" ? "Potvrdit odběr" : "Confirm subscription",
        })
        .click();
      await expect(page.getByRole("status")).toContainText(
        locale.code === "cs" ? "odběr novinek je potvrzený" : "your subscription is confirmed",
      );
      expect(await confirmed()).toBe(true);
    });

    test("chybný e-mail a chybějící souhlas: chyby u polí s aria-invalid", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const form = page.locator("#waitlist form");
      await form.getByLabel(labels.email, { exact: true }).fill("neni-email");
      await form.getByRole("button", { name: labels.submit }).click();
      await expect(form.getByText(labels.invalid)).toBeVisible();
      await expect(form.getByText(labels.noConsent)).toBeVisible();
      await expect(form.getByLabel(labels.email, { exact: true })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      // Zadaný e-mail po chybě zůstane v poli.
      await expect(form.getByLabel(labels.email, { exact: true })).toHaveValue("neni-email");
      // Zaměření přejde na první chybné pole (WCAG 3.3.1) a pole se nevytvořilo znovu.
      await expect(form.getByLabel(labels.email, { exact: true })).toBeFocused();
    });

    test("chybí jen souhlas: zaměření přejde na zaškrtávátko, e-mail zůstane", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const form = page.locator("#waitlist form");
      await form.getByLabel(labels.email, { exact: true }).fill("par@example.com");
      await form.getByRole("button", { name: labels.submit }).click();
      await expect(form.getByText(labels.noConsent)).toBeVisible();
      await expect(form.getByLabel(labels.consent)).toBeFocused();
      await expect(form.getByLabel(labels.consent)).toHaveAttribute("aria-invalid", "true");
      await expect(form.getByLabel(labels.email, { exact: true })).toHaveValue("par@example.com");
    });

    test("prázdný e-mail: hlášení o povinném poli", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const form = page.locator("#waitlist form");
      await form.getByLabel(labels.consent).check();
      await form.getByRole("button", { name: labels.submit }).click();
      await expect(form.getByText(labels.required)).toBeVisible();
    });

    test("past na roboty: skryté pole není v tabulátoru ani pro čtečky", async ({ page }) => {
      await page.goto(pageUrl(HOSTS.marketing, locale.path));
      const trap = page.locator('#waitlist input[name="website"]');
      await expect(trap).toHaveAttribute("tabindex", "-1");
      await expect(trap.locator("xpath=ancestor::div[@aria-hidden='true']")).toHaveCount(1);
    });
  });
}

test.describe("právní podstránky", () => {
  const pages = [
    { path: "/soukromi", h1: "Zpracování osobních údajů", text: "Jaké máme role podle GDPR" },
    { path: "/podminky", h1: "Podmínky služby", text: "zpracovatelské ujednání" },
    { path: "/dostupnost", h1: "Prohlášení o přístupnosti", text: "Známá omezení" },
    { path: "/en/privacy", h1: "Privacy policy", text: "GDPR roles" },
    { path: "/en/terms", h1: "Terms of service", text: "Data Processing Agreement" },
    { path: "/en/accessibility", h1: "Accessibility statement", text: "Known limitations" },
  ];

  for (const entry of pages) {
    test(`${entry.path}: text, indexace a hreflang`, async ({ request }) => {
      const { response, html } = await source(request, entry.path);
      expect(response.status()).toBe(200);
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
      expect(html).toContain(entry.h1);
      expect(html).toContain(entry.text);
      expect(html).not.toMatch(/<meta name="robots" content="noindex/);
      expect(html).toMatch(/hreflang="x-default"/i);
      const [graph] = jsonLd(html);
      const crumbs = graph["@graph"].find((node) => node["@type"] === "BreadcrumbList") as {
        itemListElement: unknown[];
      };
      expect(crumbs.itemListElement).toHaveLength(2);
    });
  }

  test("cizí jazyková varianta cesty je 404 (žádné duplicity)", async ({ request }) => {
    for (const path of ["/privacy", "/en/soukromi", "/cs/soukromi", "/soukromi/neco"]) {
      const { response } = await source(request, path);
      expect(response.status(), path).toBe(404);
    }
  });

  test("mapa webu obsahuje právní podstránky", async ({ request }) => {
    const { response, html } = await source(request, "/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(html).toContain("<loc>https://se-vezmou.cz/soukromi</loc>");
    expect(html).toContain("<loc>https://se-vezmou.cz/en/terms</loc>");
  });
});

test.describe("podstránky cena, šablony a dvojjazyčný web", () => {
  const pages = [
    { path: "/cenik", h1: "Svatební web zdarma", alt: "/en/pricing" },
    { path: "/en/pricing", h1: "A free wedding website", alt: "/cenik" },
    { path: "/sablony", h1: "Šablony svatebního webu", alt: "/en/templates" },
    { path: "/en/templates", h1: "Wedding website templates", alt: "/sablony" },
    {
      path: "/dvojjazycny-svatebni-web",
      h1: "Dvojjazyčný svatební web",
      alt: "/en/bilingual-wedding-website",
    },
    {
      path: "/en/bilingual-wedding-website",
      h1: "A wedding website for your wedding in Prague or Czechia",
      alt: "/dvojjazycny-svatebni-web",
    },
    {
      path: "/potvrzeni-ucasti-hostu",
      h1: "Potvrzení účasti hostů na svatbu online",
      alt: "/en/wedding-rsvp",
    },
    {
      path: "/en/wedding-rsvp",
      h1: "Online wedding RSVP for your guests",
      alt: "/potvrzeni-ucasti-hostu",
    },
    {
      path: "/pro-fotografy",
      h1: "Pro svatební fotografy a dodavatele",
      alt: "/en/for-photographers",
    },
    {
      path: "/en/for-photographers",
      h1: "For wedding photographers and suppliers",
      alt: "/pro-fotografy",
    },
  ];

  for (const entry of pages) {
    test(`${entry.path}: indexovatelná, canonical na sebe, hreflang a drobečky`, async ({
      request,
    }) => {
      const { response, html } = await source(request, entry.path);
      expect(response.status()).toBe(200);
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
      expect(html).toContain(entry.h1);
      expect(html).not.toMatch(/<meta name="robots" content="noindex/);
      expect(html).toContain(`<link rel="canonical" href="https://se-vezmou.cz${entry.path}"`);
      expect(html).toContain(`href="https://se-vezmou.cz${entry.alt}"`);
      const [graph] = jsonLd(html);
      const crumbs = graph["@graph"].find((node) => node["@type"] === "BreadcrumbList") as {
        itemListElement: unknown[];
      };
      expect(crumbs.itemListElement).toHaveLength(2);
      // citovatelnost pro AI: datum aktualizace (viditelné i v datech) a časté dotazy jako FAQPage
      const types = graph["@graph"].map((node) => node["@type"]);
      expect(types).toEqual(expect.arrayContaining(["WebPage", "FAQPage"]));
      const webPage = graph["@graph"].find((node) => node["@type"] === "WebPage") as {
        dateModified: string;
      };
      expect(html).toContain(`<time dateTime="${webPage.dateModified}"`);
      const faq = graph["@graph"].find((node) => node["@type"] === "FAQPage") as {
        mainEntity: { name: string }[];
      };
      for (const question of faq.mainEntity) expect(html).toContain(question.name);
      // nabídka s cenou je na všech podstránkách kromě stránky pro fotografy
      expect(types.includes("SoftwareApplication")).toBe(
        !/fotograf|photographers/.test(entry.path),
      );
    });
  }

  test("šablony: popis každé šablony a názvy palet z jejich definice", async ({ request }) => {
    const { html } = await source(request, "/sablony");
    expect(html).toContain("Barevné palety: Bordó, Stříbrná, Hloubka, Pudr");
    expect(html).toContain("Barevné palety: Champagne, Slonová kost, Noc, Růže");
    expect(html).toContain("Barevné palety: Půlnoc, Smaragd, Bordó, Opál");
    expect(html).toContain("Mohu šablonu změnit i po zveřejnění webu?");
    const { html: en } = await source(request, "/en/templates");
    expect(en).toContain("Colour palettes: Burgundy, Silver, Depth, Powder");
  });

  test("pro fotografy: odkaz s kódem partnera, QR kód a leták jen při tisku", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/pro-fotografy"));
    await expect(page.getByText(/Po\snapsání\sjména/)).toBeVisible();
    await page.getByLabel("Jméno studia nebo fotografa").fill("Foto Klára Nová");
    await expect(page.getByTestId("partner-url")).toHaveText(
      "https://se-vezmou.cz/?utm_source=foto-klara-nova&utm_medium=partner&utm_campaign=doporuceni",
    );
    await expect(page.getByRole("img", { name: /QR kód s doporučujícím odkazem/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Vytisknout leták" })).toBeVisible();
    await page.emulateMedia({ media: "print" });
    const leaflet = page.getByRole("region", { name: "Svatební web pro vaše hosty" });
    await expect(leaflet).toBeVisible();
    await expect(leaflet).toContainText("Doporučuje Foto Klára Nová");
    await expect(page.getByRole("heading", { level: 1 })).toBeHidden();
    await expect(page.getByRole("button", { name: "Vytisknout leták" })).toBeHidden();
  });

  test("cizí jazyková varianta cesty je 404", async ({ request }) => {
    for (const path of [
      "/pricing",
      "/en/cenik",
      "/templates",
      "/en/sablony",
      "/bilingual-wedding-website",
      "/for-photographers",
      "/en/pro-fotografy",
      "/rsvp",
      "/en/potvrzeni-ucasti-hostu",
    ]) {
      const { response } = await source(request, path);
      expect(response.status(), path).toBe(404);
    }
  });

  test("mapa webu obsahuje nové stránky", async ({ request }) => {
    const { html } = await source(request, "/sitemap.xml");
    for (const entry of pages)
      expect(html).toContain(`<loc>https://se-vezmou.cz${entry.path}</loc>`);
  });

  test("llms.txt: popis služby a odkazy na stránky z mapy webu", async ({ request }) => {
    const { response, html } = await source(request, "/llms.txt");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/plain");
    expect(html).toMatch(/^# Se vezmou/);
    for (const entry of pages) expect(html).toContain(`(https://se-vezmou.cz${entry.path})`);
  });
});

test.describe("zaměření, cíle dotyku a reflow", () => {
  // Při omezeném pohybu se přechody zkracují na 0,01 ms a obrys by se při měření ještě rozbíhal.
  test.use({ reducedMotion: "no-preference" });

  test("skip link přesune zaměření na obsah", async ({ page }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Přeskočit na obsah" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#obsah")).toBeFocused();
  });

  test("obrys zaměření na tmavé závěrečné sekci má vůči pozadí aspoň 3 : 1 (WCAG 1.4.11, 2.4.13)", async ({
    page,
  }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    const section = page.locator("#start");
    await section.scrollIntoViewIfNeeded();
    for (const target of [
      section.getByLabel("První jméno"),
      section.getByLabel("Druhé jméno"),
      section.getByRole("button"),
    ]) {
      await target.focus();
      const colors = await target.evaluate((el) => {
        const outline = getComputedStyle(el).outlineColor;
        const background = getComputedStyle(el.closest("section")!).backgroundColor;
        return { outline, background };
      });
      const rgb = (value: string) =>
        value
          .match(/\d+(\.\d+)?/g)!
          .slice(0, 3)
          .map(Number);
      const luminance = ([r, g, b]: number[]) => {
        const [lr, lg, lb] = [r, g, b].map((c) => {
          const v = c / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
      };
      const [a, b] = [luminance(rgb(colors.outline)), luminance(rgb(colors.background))];
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      expect(ratio, `${colors.outline} na ${colors.background}`).toBeGreaterThanOrEqual(3);
    }
  });

  test("odkaz na úvod má přístupný název s viditelným textem (WCAG 2.5.3)", async ({ page }) => {
    for (const [path, name] of [
      ["/", "se-vezmou.cz, úvodní stránka"],
      ["/en", "se-vezmou.cz, home page"],
    ]) {
      await page.goto(pageUrl(HOSTS.marketing, path));
      const logo = page.locator("header").getByRole("link", { name });
      await expect(logo).toBeVisible();
      expect(name).toContain(((await logo.textContent()) ?? "").trim());
    }
  });

  test("bez JavaScriptu je navigace na mobilu dostupná (nabídka rozbalená, tlačítko skryté)", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    await expect(page.getByRole("button", { name: "Nabídka" })).toBeHidden();
    const nav = page.getByRole("navigation", { name: "Hlavní navigace" });
    await expect(nav.getByRole("link", { name: "Cena" })).toBeVisible();
    await expect(page.locator("header").getByRole("link", { name: "Vytvořit web" })).toBeVisible();
    await context.close();
  });

  test("viditelný focus a cíle dotyku 44 px u odkazů, tlačítek a otázek FAQ", async ({
    page,
    isMobile,
  }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    await openMenuIfCollapsed(page, isMobile);
    const targets = page.locator("header :is(a, button), main :is(a, button, summary), footer a");
    const boxes = await targets.evaluateAll((els) =>
      els
        .filter((el) => el.getBoundingClientRect().width > 0 && !el.closest("[aria-hidden='true']"))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { text: el.textContent?.trim(), width: r.width, height: r.height };
        }),
    );
    expect(boxes.length).toBeGreaterThan(10);
    for (const box of boxes) {
      expect(box.height, `${box.text}`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${box.text}`).toBeGreaterThanOrEqual(44);
    }
  });

  test("klávesnicí se dá projít celá stránka a každý prvek má viditelný obrys", async ({
    page,
    isMobile,
  }) => {
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    await openMenuIfCollapsed(page, isMobile);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const outline = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const style = getComputedStyle(el);
        return {
          tag: el.tagName,
          style: style.outlineStyle,
          width: parseFloat(style.outlineWidth),
        };
      });
      expect(outline.style, outline.tag).not.toBe("none");
      expect(outline.width, outline.tag).toBeGreaterThanOrEqual(2);
    }
  });

  test("šířka 320 px bez vodorovného posouvání na všech stránkách", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ["/", "/en", "/soukromi", "/en/privacy"]) {
      await page.goto(pageUrl(HOSTS.marketing, path));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("text lze zvětšit na 200 % bez ztráty obsahu (reflow)", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 800 });
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("přechody mezi stránkami", () => {
  async function navigateToPricing(page: Page): Promise<"yes" | "no" | null> {
    await page.addInitScript(() => {
      window.addEventListener("pagereveal", (event) => {
        sessionStorage.setItem(`vt-${location.pathname}`, event.viewTransition ? "yes" : "no");
      });
    });
    await page.goto(pageUrl(HOSTS.marketing, "/"));
    // Odkaz v hlavičce může být v mobilní variantě skrytý; přechod ověřujeme kliknutím v dokumentu
    await page.evaluate(() =>
      document.querySelector<HTMLAnchorElement>('a[href="/cenik"]')?.click(),
    );
    await page.waitForURL("**/cenik");
    await expect(page.locator("h1")).toBeVisible();
    return page.evaluate(() => sessionStorage.getItem("vt-/cenik") as "yes" | "no" | null);
  }

  test.describe("bez omezení pohybu", () => {
    test.use({ reducedMotion: "no-preference", locale: "cs-CZ" });
    test("přechod mezi dokumenty se spustí", async ({ page }) => {
      expect(await navigateToPricing(page)).toBe("yes");
    });
  });

  test.describe("s omezeným pohybem", () => {
    test.use({ reducedMotion: "reduce", locale: "cs-CZ" });
    test("bez animace (WCAG 2.3.3)", async ({ page }) => {
      expect(await navigateToPricing(page)).toBe("no");
    });
  });
});
