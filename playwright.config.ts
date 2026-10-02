import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { E2E_SECRETS, appDatabaseUrl } from "./e2e/support/env";

/**
 * E2E a přístupnost (ADR 0004). Testy běží proti produkčnímu sestavení (`next start`),
 * hostitele řeší `*.localhost` (Chromium je překládá na loopback samo).
 *
 * Testy přihlášení (M4) potřebují databázi s migracemi a e-mail zapisovaný do souborů místo odeslání.
 * Spouštějí se přes `npm run test:e2e` a `npm run test:a11y`, tedy přes `scripts/e2e-db.sh`, který
 * databázi připraví (dočasný PostgreSQL, nebo v CI service container) a předá ji jako
 * `E2E_DATABASE_URL` (vlastník, pro testovací pomocníky) a `E2E_APP_DATABASE_URL` (role se_vezmou_app).
 * Aplikace mluví s Postgresem přímo přes `pg` jako se_vezmou_app, jako v produkci (ADR 0011).
 *
 * Lokálně lze použít již stažený Chromium: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`.
 * V CI se stahuje `npx playwright install --with-deps chromium`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

// Adresář pro e-maily jednoho běhu; proměnná se předá pracovním procesům i aplikaci.
process.env.E2E_OUTBOX_DIR ??= mkdtempSync(join(tmpdir(), "sevezmou-e2e-outbox-"));

export default defineConfig({
  testDir: "./e2e",
  // Zveřejněný ukázkový web `klara-a-matej` pro testy hostitelů, webu páru a přístupnosti.
  globalSetup: "./e2e/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    // Rozhraní správy volí jazyk podle Accept-Language; testy jedou česky, angličtina má vlastní test.
    locale: "cs-CZ",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath,
      // `*.localhost` vždy na loopback, i kdyby systém nabízel jiné překlady nebo proxy.
      args: ["--host-resolver-rules=MAP *.localhost 127.0.0.1", "--proxy-bypass-list=*"],
    },
  },
  projects: [
    {
      name: "e2e",
      testMatch: /.*\.e2e\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "a11y",
      testMatch: /.*\.a11y\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Úvodní stránka a průvodce i v mobilním viewportu (Chromium s rozlišením telefonu, dotykový vstup).
    {
      name: "e2e-mobile",
      testMatch: /(landing|wizard)\.e2e\.ts$/,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "a11y-mobile",
      testMatch: /(landing|wizard)\.a11y\.ts$/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/robots.txt`,
    // Server vždy nový: míří na databázi tohoto běhu (E2E_APP_DATABASE_URL). Jen pro ladění lze použít
    // už běžící server (`E2E_REUSE_SERVER=1`), který míří na tutéž databázi.
    reuseExistingServer: Boolean(process.env.E2E_REUSE_SERVER),
    timeout: 300_000,
    env: {
      // Kořenová doména pro lokální hostitele a zapnutý vizuální katalog (mimo produkci).
      ROOT_DOMAIN: "localhost",
      ENABLE_UI_CATALOG: "1",
      // Přihlášení (M4): přímé spojení s Postgresem jako se_vezmou_app, e-maily do souborů, testovací tajné hodnoty.
      DATABASE_URL: appDatabaseUrl(),
      EMAIL_TRANSPORT: "outbox",
      EMAIL_OUTBOX_DIR: process.env.E2E_OUTBOX_DIR as string,
      ...E2E_SECRETS,
      // Adresa průvodce pro tlačítka a pole jmen: lokální hostitel `app.` (zástupná stránka).
      NEXT_PUBLIC_APP_URL: `http://app.localhost:${PORT}`,
    },
  },
});
