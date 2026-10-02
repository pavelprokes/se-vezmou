import { defineConfig, devices } from "@playwright/test";

/**
 * E2E a přístupnost (ADR 0004). Testy běží proti produkčnímu sestavení (`next start`),
 * hostitele řeší `*.localhost` (Chromium je překládá na loopback samo).
 *
 * Lokálně lze použít již stažený Chromium: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`.
 * V CI se stahuje `npx playwright install --with-deps chromium`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
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
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/robots.txt`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      // Kořenová doména pro lokální hostitele a zapnutý vizuální katalog (mimo produkci).
      ROOT_DOMAIN: "localhost",
      ENABLE_UI_CATALOG: "1",
    },
  },
});
