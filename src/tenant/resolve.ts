import "server-only";
import { resolveSlug, type ResolvedSlug } from "@/lib/db/rpc";

/**
 * Ověření existence webu páru podle adresy (`resolve_slug` v databázi). Neexistující, nezveřejněná,
 * smazaná i zablokovaná adresa dávají stejný výsledek `null` a tedy identickou stránku 404
 * (FR-PRIV-3, docs/data-model.md kap. 5.5): nejde poznat, které adresy existují.
 */
export async function resolveTenant(slug: string): Promise<ResolvedSlug | null> {
  return resolveSlug(slug);
}

export async function tenantExists(slug: string): Promise<boolean> {
  return (await resolveTenant(slug)) !== null;
}
