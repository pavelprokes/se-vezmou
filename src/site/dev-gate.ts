import { env as appEnv } from "@/env";
import { isProductionLike, testHatchesAllowed, type EnvSource } from "@/lib/test-hatches";

/**
 * Vývojářské stránky (náhled šablon): ve vývojovém režimu vždy, v produkčním sestavení jen s
 * `ENABLE_UI_CATALOG=1` a opt-in vrátek (`ALLOW_TEST_HATCHES=1`), nikdy v ostré produkci (`src/lib/test-hatches.ts`).
 * Čte prostředí při každém volání; volající stránka musí být vykreslená za běhu (`connection()`).
 */
export function devPagesEnabled(env: EnvSource = appEnv): boolean {
  if (!isProductionLike(env)) return true;
  return env.ENABLE_UI_CATALOG === "1" && testHatchesAllowed(env);
}
