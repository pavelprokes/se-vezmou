import type { Locale } from "../src/i18n/config";
import type { Locator, Page } from "@playwright/test";
import { HOSTS, pageUrl } from "./hosts";

/** Pomocníci pro formulář RSVP na webu páru (host `klara-a-matej.localhost`). */

export const tenant = (path = "/") => pageUrl(HOSTS.tenant, path);

/** Sekce Potvrdit účast. */
export function rsvpSection(page: Page): Locator {
  return page.locator("#potvrdit-ucast");
}

export async function openRsvp(page: Page, lang: Locale = "cs"): Promise<Locator> {
  await page.goto(tenant(lang === "cs" ? "/" : "/en"));
  const section = rsvpSection(page);
  await section.scrollIntoViewIfNeeded();
  return section;
}

/** Krok 1: jméno do prázdného pole a odeslání; čeká na odpověď serveru. */
export async function identify(page: Page, name: string, lang: Locale = "cs"): Promise<void> {
  const section = rsvpSection(page);
  await section.getByLabel(lang === "cs" ? "Vaše jméno" : "Your name").fill(name);
  const response = page.waitForResponse((r) => r.request().method() === "POST");
  await section.getByRole("button", { name: lang === "cs" ? "Pokračovat" : "Continue" }).click();
  await response;
}

/** Skupina voleb "Osoba: Událost" a volba Přijde/Nepřijde. */
export async function choose(
  section: Locator,
  person: string,
  event: string,
  value: "yes" | "no",
  lang: Locale = "cs",
): Promise<void> {
  const group = section.getByRole("group", { name: `${person}: ${event}` });
  const label =
    value === "yes"
      ? lang === "cs"
        ? "Přijde"
        : "Attending"
      : lang === "cs"
        ? "Nepřijde"
        : "Not attending";
  await group.getByRole("radio", { name: label, exact: true }).check();
}

export async function send(page: Page, lang: Locale = "cs"): Promise<void> {
  const section = rsvpSection(page);
  const response = page.waitForResponse((r) => r.request().method() === "POST");
  await section
    .getByRole("button", {
      name: lang === "cs" ? /^(Odeslat odpověď|Uložit změny)$/ : /^(Send reply|Save changes)$/,
    })
    .click();
  await response;
}
