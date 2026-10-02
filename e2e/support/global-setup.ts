import { eukalyptusFixture } from "../../src/site/fixtures/klara-a-matej";
import { seedPublishedSite, withDb } from "./db";

/**
 * Společné údaje před všemi testy: zveřejněný ukázkový web Klára a Matěj (`klara-a-matej.localhost`),
 * na který se odvolávají testy hostitelů, webu páru a přístupnosti. Web z fixtury už nevrací
 * zástupná implementace, ale databáze (M5), proto se do ní zakládá jako každý jiný.
 * Databáze je pro každý běh nová (`scripts/e2e-db.sh`); opakované spuštění nad stejnou databází
 * (`E2E_REUSE_SERVER`) web nezaloží podruhé.
 */
export default async function globalSetup(): Promise<void> {
  const exists = await withDb(async (db) => {
    const result = await db.query("select 1 from public.weddings where slug = $1", [
      eukalyptusFixture.slug,
    ]);
    return result.rowCount === 1;
  });
  if (exists) return;
  await seedPublishedSite({ slug: eukalyptusFixture.slug, content: eukalyptusFixture });
}
