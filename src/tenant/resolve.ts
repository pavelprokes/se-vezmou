/**
 * Ověření existence webu páru podle slugu.
 *
 * ZÁSTUPNÁ IMPLEMENTACE pro M1 (bez databáze): zná jen vymyšlený ukázkový pár Klára a Matěj.
 * V M3 ji nahradí volání `resolve_slug`. Neexistující, nezveřejněná, smazaná i blokovaná adresa
 * musí vracet stejný výsledek `false` a tedy identickou stránku 404 (FR-PRIV-3).
 */
const PLACEHOLDER_TENANTS: readonly string[] = ["klara-a-matej"];

export function tenantExists(slug: string): boolean {
  return PLACEHOLDER_TENANTS.includes(slug);
}
