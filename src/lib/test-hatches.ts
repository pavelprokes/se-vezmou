/**
 * Testovací „zadní vrátka“ (hatches) a jejich společná pojistka. Čistý modul bez závislostí
 * (používá ho i proxy), proto přijímá prostředí jako parametr.
 *
 * Vrátka jsou proměnné prostředí, které v automatických testech zapínají zkratky:
 *  - `CRON_TEST_CLOCK=1`          simulovaný čas a `wedding_id` pro `/api/cron/*`,
 *  - `EMAIL_TRANSPORT=outbox`     e-maily do souborů místo odeslání,
 *  - `STORAGE_DRIVER=memory`      fotografie v paměti místo Cloudflare R2,
 *  - `ENABLE_UI_CATALOG=1`        vývojářské stránky (katalog UI, náhled šablon) v produkčním sestavení,
 *  - `OG_FETCH_TEST_HOST=…`       falešný cílový server pro karty externí galerie,
 *  - `HOST_PRESET` + `PREVIEW_TENANT_SLUG` předvolba hostitele (viz `hostPresetAllowed`).
 *
 * Pravidlo: vrátka fungují jen tehdy, když sestavení NENÍ „produkční“ (`NODE_ENV!==production`, tedy
 * `next dev` a vitest), nebo když je výslovně nastaveno `ALLOW_TEST_HATCHES=1` (e2e a CI, které jedou
 * proti produkčnímu sestavení). V ostré produkci (`VERCEL_ENV=production`) nefungují nikdy, ani s
 * `ALLOW_TEST_HATCHES=1`. Nastavená vrátka v sestavení, kde nesmí fungovat, nejsou tiše ignorována:
 * `assertTestHatchesSafe` (volá se při startu serveru, `instrumentation.ts`) vyhodí srozumitelnou chybu.
 */

export type EnvSource = Record<string, string | undefined>;

/** Sestavení běžící jako produkce: `NODE_ENV=production` (i náhledy Vercelu) nebo `VERCEL_ENV=production`. */
export function isProductionLike(env: EnvSource = process.env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

/** Ostrá produkce na Vercelu: žádná vrátka, žádná výjimka. */
export function isVercelProduction(env: EnvSource = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

/** Smějí v tomto sestavení fungovat testovací vrátka? */
export function testHatchesAllowed(env: EnvSource = process.env): boolean {
  if (isVercelProduction(env)) return false;
  if (!isProductionLike(env)) return true;
  return env.ALLOW_TEST_HATCHES === "1";
}

const NON_MARKETING_PRESETS = ["app", "admin", "tenant"];
const PRESETS = ["marketing", ...NON_MARKETING_PRESETS];

/**
 * Předvolba hostitele pro náhledy mimo kořenovou doménu. `marketing` je dočasně povolena i v produkčním
 * sestavení mimo ostrou produkci (úvodní stránka na `*.vercel.app`). `app` a `admin` se nikdy nepovolí
 * v produkčním sestavení; `tenant` jen s opt-in vrátek.
 */
export function hostPresetAllowed(
  preset: string | undefined,
  env: EnvSource = process.env,
): boolean {
  if (!preset || !PRESETS.includes(preset)) return false;
  if (isVercelProduction(env)) return false;
  if (preset === "marketing") return true;
  if (!isProductionLike(env)) return true;
  return preset === "tenant" && env.ALLOW_TEST_HATCHES === "1";
}

/** Názvy vrátek, která jsou v prostředí nastavena (bez ohledu na to, zda smějí fungovat). */
export function activeTestHatches(env: EnvSource = process.env): string[] {
  const active: string[] = [];
  if (env.CRON_TEST_CLOCK) active.push("CRON_TEST_CLOCK");
  if (env.EMAIL_TRANSPORT === "outbox") active.push("EMAIL_TRANSPORT=outbox");
  if (env.STORAGE_DRIVER === "memory") active.push("STORAGE_DRIVER=memory");
  if (env.ENABLE_UI_CATALOG === "1") active.push("ENABLE_UI_CATALOG");
  if (env.OG_FETCH_TEST_HOST) active.push("OG_FETCH_TEST_HOST");
  if (env.HOST_PRESET && NON_MARKETING_PRESETS.includes(env.HOST_PRESET)) {
    active.push(`HOST_PRESET=${env.HOST_PRESET}`);
  }
  return active;
}

/**
 * Při startu serveru: vrátka nastavená tam, kde nesmí fungovat, jsou chyba nasazení. `next dev` a
 * vitest (`NODE_ENV!==production`) projdou vždy.
 */
export function assertTestHatchesSafe(env: EnvSource = process.env): void {
  if (env.ALLOW_TEST_HATCHES === "1" && isVercelProduction(env)) {
    throw new Error(
      "ALLOW_TEST_HATCHES=1 nesmí být nastaveno v ostré produkci (VERCEL_ENV=production). Odstraňte proměnnou.",
    );
  }
  if (!isProductionLike(env)) return;
  const stray = activeTestHatches(env).filter((name) =>
    name.startsWith("HOST_PRESET=")
      ? !hostPresetAllowed(env.HOST_PRESET, env)
      : !testHatchesAllowed(env),
  );
  if (stray.length > 0) {
    throw new Error(
      `Testovací nastavení (${stray.join(", ")}) nesmí být v produkčním sestavení. ` +
        "Odstraňte je z prostředí; jen e2e a CI je smějí zapnout výslovným ALLOW_TEST_HATCHES=1.",
    );
  }
}
