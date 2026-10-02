import { test as base, type Page } from "@playwright/test";
import { HOSTS, pageUrl } from "../hosts";
import { randomIp } from "./db";

/**
 * Společná sada pro testy přihlášení. Každý test má vlastní IP (hlavička `X-Forwarded-For`, kterou
 * aplikace mimo Vercel čte), takže testy běžící naráz nesdílejí čítače omezení počtu požadavků.
 */
export const test = base.extend<{ ip: string }>({
  ip: [
    async ({ context }, use) => {
      const ip = randomIp();
      await context.setExtraHTTPHeaders({ "x-forwarded-for": ip });
      await use(ip);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";

export const app = (path = "/") => pageUrl(HOSTS.app, path);

/** E-mail -> stránka s kódem. Vrací po přesměrování na `/prihlaseni/kod`. */
export async function requestCode(page: Page, email: string): Promise<void> {
  await page.goto(app("/prihlaseni"));
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Poslat kód" }).click();
  await page.waitForURL(app("/prihlaseni/kod"));
}

/**
 * Klik na odeslání a počkání na odpověď serveru. Po akci React vyprázdní formulář, proto další
 * vyplňování smí začít až po odpovědi (jinak by test psal do pole těsně před jeho vyprázdněním).
 */
export async function submitAndWait(page: Page, button: string | RegExp): Promise<void> {
  const response = page.waitForResponse((r) => r.request().method() === "POST");
  await page.getByRole("button", { name: button }).click();
  await response;
  await page
    .evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
    .catch(() => undefined);
}
