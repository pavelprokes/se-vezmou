import { withDb } from "./db";
import { ensureWedding } from "./rsvp-db";

/**
 * Společné údaje před všemi testy: zveřejněný ukázkový web Klára a Matěj (`klara-a-matej.localhost`),
 * na který se odvolávají testy hostitelů, webu páru, RSVP a přístupnosti. Web se čte z databáze (M5),
 * proto se do ní zakládá jako každý jiný (sdílená svatba z `rsvp-db.ts`, snímek je fixtura).
 * Databáze je pro každý běh nová (`scripts/e2e-db.sh`); založení je idempotentní, takže opakované
 * spuštění nad stejnou databází (`E2E_REUSE_SERVER`) web nezaloží podruhé.
 */
export default async function globalSetup(): Promise<void> {
  await withDb((db) => ensureWedding(db));
}
