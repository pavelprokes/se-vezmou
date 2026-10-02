import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { HOSTS, pageUrl, PORT } from "../hosts";
import { codeOf, waitForMail } from "./mail";

/** Pomocníci pro testy průvodce (`app.localhost/vytvorit`, M5). */

export const wizardUrl = (query = "", locale: "cs" | "en" = "cs") =>
  pageUrl(HOSTS.app, `${locale === "cs" ? "" : "/en"}/vytvorit${query}`);

/** Mobilní rozložení: jedna malá skupina otázek na obrazovku (do 48 rem). */
export function isCompact(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 768;
}

export const heading = (page: Page) => page.locator("#wz-heading");

/** Adresa webu páru na subdoméně `*.localhost`. */
export const siteUrl = (slug: string, path = "/") => pageUrl(`${slug}.localhost`, path);

export async function next(page: Page): Promise<void> {
  await page.getByTestId("next").click();
}

/** Další, dokud krok neskončí: na mobilu má krok víc obrazovek, na počítači jednu. */
export async function nextScreen(page: Page): Promise<void> {
  if (isCompact(page)) await next(page);
}

export const dayIso = "2027-06-19";

/** Krok 1 až 3: jména, datum a adresa, šablona a barvy. Skončí na kroku 4. */
export async function completeRequiredSteps(
  page: Page,
  options: { a?: string; b?: string; slug: string; template?: RegExp; palette?: RegExp },
): Promise<void> {
  const { a = "Klára", b = "Matěj", slug } = options;
  await page.goto(wizardUrl(""));
  await expect(heading(page)).toHaveText("Kdo se bere?");
  await page.getByLabel("První jméno").fill(a);
  await page.getByLabel("Druhé jméno").fill(b);
  await nextScreen(page);
  await next(page);

  await expect(heading(page)).toHaveText("Kdy a kde najdou hosté váš web?");
  await page.getByLabel("Datum svatby").fill(dayIso);
  await nextScreen(page);
  await page.getByLabel("Adresa webu").fill(slug);
  await expect(page.getByTestId("slug-status")).toHaveText(/vypadá volná/);
  await next(page);

  await expect(heading(page)).toHaveText("Vyberte vzhled webu");
  await page.getByRole("radio", { name: options.template ?? /Chateau/ }).check();
  await nextScreen(page);
  await page.getByRole("radio", { name: options.palette ?? /Slonová kost/ }).check();
  await next(page);
  await expect(heading(page)).toHaveText("Program dne a místo konání");
}

/** Kroky 4 až 7 vyplněné ukázkovými údaji; skončí na kroku 8 (kontrola). */
export async function fillOptionalSteps(page: Page): Promise<{ pin: string }> {
  // 4. Program a místo
  await page.getByLabel("Přidat obřad").check();
  await page.getByLabel("Čas obřadu").fill("14:00");
  await page.getByLabel("Název místa").fill("Zámecká kaple");
  await page.getByLabel("Adresa místa").fill("Zámecká 1, Dobřichovice");
  await nextScreen(page);
  await page.getByLabel("Přidat hostinu").check();
  await page.getByLabel("Čas hostiny").fill("16:30");
  await nextScreen(page);
  await page.getByRole("button", { name: "Přidat bod programu" }).click();
  await page.getByLabel("Název", { exact: true }).fill("První tanec");
  await page.getByLabel("Čas", { exact: true }).fill("20:00");
  await next(page);

  // 5. Praktické informace
  await expect(heading(page)).toHaveText("Co by hosté měli vědět");
  await page.getByLabel("Dress code").fill("Slavnostní, bez bílé.");
  await nextScreen(page);
  await page.getByRole("button", { name: "Přidat ubytování" }).click();
  await page.getByLabel("Název", { exact: true }).fill("Penzion U Řeky");
  await nextScreen(page);
  await page.getByLabel("Doprava a parkování").fill("Vlak jede každou půlhodinu.");
  await nextScreen(page);
  await page.getByRole("button", { name: "Přidat kontakt" }).click();
  await page.getByLabel("Jméno", { exact: true }).fill("Eva Nováková");
  await page.getByLabel("Telefon (nepovinné)").fill("+420 777 123 456");
  await next(page);

  // 6. Potvrzení účasti
  await expect(heading(page)).toHaveText("Jak budou hosté potvrzovat účast?");
  await page.getByLabel(/Potvrdit účast do/).fill("2027-05-01");
  await nextScreen(page);
  await page.getByLabel("Host může přivést doprovod").check();
  await next(page);

  // 7. Přístup a soukromí
  await expect(heading(page)).toHaveText("Kdo smí web vidět?");
  await page.getByLabel("Chránit citlivé části webu PINem").check();
  const pin = await page.getByRole("textbox", { name: "PIN pro hosty" }).inputValue();
  await next(page);
  await expect(heading(page)).toHaveText("Zkontrolujte, co jste zadali");
  return { pin };
}

/** E-mail, záložní e-mail a kód z e-mailu v dialogu prvního uložení. Po ověření dialog pokračuje sám. */
export async function verifyEmail(
  page: Page,
  emails: { email: string; backup: string },
): Promise<void> {
  // Název dialogu se mezi fázemi mění (e-mail, kód), proto se hledá podle otevřeného dialogu.
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("heading", { name: "Uložte svůj koncept" })).toBeVisible();
  await dialog.getByLabel("Váš e-mail").fill(emails.email);
  await dialog.getByLabel("Záložní e-mail").fill(emails.backup);
  await dialog.getByRole("button", { name: "Poslat kód" }).click();
  await expect(page.getByRole("heading", { name: "Zadejte kód z e-mailu" })).toBeVisible();
  const mail = await waitForMail(emails.email);
  await dialog.getByLabel("Šestimístný kód").fill(codeOf(mail));
  await dialog.getByRole("button", { name: "Ověřit a uložit" }).click();
}

export { PORT };
