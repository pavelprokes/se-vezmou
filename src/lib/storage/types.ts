import { z } from "zod";

/**
 * Rozhraní úložiště fotografií (docs/adr/0006-photo-storage.md). Aplikace smí s úložištěm mluvit jen
 * přes ně: implementaci na Cloudflare R2 (S3 API) přinese M7c, do té doby běží `noopStorage` (nic neuchovává)
 * a v testech `createMemoryStorage`.
 *
 * Soubory svatby leží pod předponou `{wedding_id}/` (ADR 0006). Všechny operace berou jen identifikátor
 * svatby, nikdy volnou předponu: prázdná nebo odvozená předpona by mohla smazat cizí data, proto se
 * identifikátor vždy ověří jako UUID (`weddingPrefix`).
 */

export type StoredObject = {
  /** Úplný klíč souboru včetně předpony `{wedding_id}/`. */
  key: string;
  bytes: number;
};

export interface PhotoStorage {
  /** Soubory svatby (pro export a kontrolu). Nikdy nevypisuje soubory jiné svatby. */
  listPrefix(weddingId: string): Promise<StoredObject[]>;
  /**
   * Smaže všechny soubory svatby (předpona `{wedding_id}/`). Idempotentní: smazání prázdné předpony uspěje.
   * Při selhání vyhazuje chybu a nesmí smazání označit za provedené: úloha retence pak web NEoznačí za
   * vymazaný a zkusí to znovu (docs/data-model.md kap. 10).
   */
  deletePrefix(weddingId: string): Promise<{ deleted: number }>;
}

const uuid = z.guid();

/** Předpona souborů svatby `{wedding_id}/`; neplatný identifikátor je chyba programu. */
export function weddingPrefix(weddingId: string): string {
  if (!uuid.safeParse(weddingId).success) {
    throw new Error("Neplatný identifikátor svatby pro úložiště");
  }
  return `${weddingId.toLowerCase()}/`;
}
