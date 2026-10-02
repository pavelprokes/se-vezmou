import "server-only";
import { housekeeping, purgeExpiredSlugReservations } from "@/lib/lifecycle/rpc";
import type { JobDefinition } from "../run";
import { createStepRunner } from "../steps";

/**
 * Denní úklid (docs/data-model.md kap. 6 bod 5 a kap. 10): uvolnění rezervací adres u nezveřejněných konceptů
 * (zveřejněná adresa se nikdy neuvolní), úklid prošlých relací, výzev, lístků a čítačů a provozních záznamů bez
 * osobních údajů (analytika, záznam e-mailů, běhy úloh). Audit se nemaže. Úklid je globální (nejde omezit na
 * jednu svatbu) a čas nejde simulovat, proto ho testovací hodina nepřipouští (viz `handler.ts`).
 */
export const housekeepingJob: JobDefinition = {
  name: "housekeeping",
  async run(context) {
    const runner = createStepRunner("housekeeping");
    const scope = { now: context.now, dryRun: context.dryRun };

    runner.counts.slug_reservations_released =
      (await runner.step("release_slug_reservations", () => purgeExpiredSlugReservations(scope))) ??
      0;

    const cleaned = await runner.step("housekeeping", () => housekeeping(scope));
    for (const [key, value] of Object.entries(cleaned ?? {})) {
      runner.counts[`cleaned_${key}`] = value;
    }
    return runner.result();
  },
};
