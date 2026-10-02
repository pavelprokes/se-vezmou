import { withDb } from "./db";
import { startOgServer } from "./og-server";
import { ensureWedding } from "./rsvp-db";

/**
 * Společné údaje před všemi testy: zveřejněný ukázkový web Klára a Matěj (`klara-a-matej.localhost`),
 * na který se odvolávají testy hostitelů, webu páru, RSVP a přístupnosti. Web se čte z databáze (M5),
 * proto se do ní zakládá jako každý jiný (sdílená svatba z `rsvp-db.ts`, snímek je fixtura).
 * Databáze je pro každý běh nová (`scripts/e2e-db.sh`); založení je idempotentní, takže opakované
 * spuštění nad stejnou databází (`E2E_REUSE_SERVER`) web nezaloží podruhé.
 *
 * Navíc se spustí falešný cílový server pro karty externí galerie (správa webu, M7a); aplikace se
 * k němu připojuje jen přes `OG_FETCH_TEST_HOST` v `playwright.config.ts`. Vrácená funkce ho po
 * všech testech zastaví.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  await withDb((db) => ensureWedding(db));
  return startOgServer();
}
