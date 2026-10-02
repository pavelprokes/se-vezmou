import { eukalyptusFixture } from "./fixtures/klara-a-matej";
import type { PublicContent } from "./types";

/**
 * Zveřejněný obsah webu podle adresy (`slug`).
 *
 * TODO(M5): nahradit voláním `get_public_site` přes server s rolí `visitor` (zveřejněný snímek
 * `site_versions.public_content`, ověřený `publicContentSchema`). Do té doby vrací jen ukázkovou
 * fixturu vymyšleného páru Klára a Matěj; ostatní adresy neexistují (stejná 404 jako `tenantExists`).
 * Citlivý obsah za PINem (`SensitiveContent`) se sem záměrně nedostává, přijde s M8-7.
 */
export async function getPublicContent(slug: string): Promise<PublicContent | null> {
  return slug === eukalyptusFixture.slug ? eukalyptusFixture : null;
}
