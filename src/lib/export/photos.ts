import "server-only";
import { getStorage, type StoredObject } from "@/lib/storage";

/**
 * Export fotografií před vypršením webu (FR-LC-2, docs/adr/0006-photo-storage.md): archiv největších
 * zpracovaných variant ke stažení jen po přihlášení správce (žádný veřejný odkaz).
 *
 * TODO(M7c): úložiště (R2) a zpracování obrázků přinese M7c. Do té doby rozhraní jen vypíše soubory svatby
 * z `src/lib/storage` (u výchozího úložiště žádné) a archiv se nesestavuje (`status: "not_available"`).
 * M7c doplní: výběr největší varianty každé fotografie, ZIP po proudu a krátkodobě platnou podepsanou adresu
 * pro přihlášeného správce.
 */

export type PhotoExportPlan =
  { status: "not_available"; files: number } | { status: "ready"; files: StoredObject[] };

/** Co by se v exportu fotografií sešlo (jen pro správce dané svatby: `weddingId` pochází z ověřené relace). */
export async function planPhotoExport(weddingId: string): Promise<PhotoExportPlan> {
  const files = await getStorage().listPrefix(weddingId);
  // TODO(M7c): vrátit `ready` se seznamem a sestavit archiv, až bude skutečné úložiště
  return { status: "not_available", files: files.length };
}
