import { weddingPrefix, type PhotoStorage, type StoredObject } from "./types";

/**
 * Úložiště v paměti: jen pro testy (a vývoj před M7c). Soubory se ukládají pod klíčem `{wedding_id}/…`.
 * Selhání mazání jde nasimulovat (`failDeleteFor`), aby šlo ověřit, že úloha retence web neoznačí za vymazaný.
 */
export type MemoryStorage = PhotoStorage & {
  put(key: string, bytes?: number): void;
  keys(): string[];
  /** Mazání těchto svateb selže (dokud se nezavolá `failDeleteFor.clear()`). */
  failDeleteFor: Set<string>;
};

export function createMemoryStorage(): MemoryStorage {
  const files = new Map<string, number>();
  const failDeleteFor = new Set<string>();
  return {
    failDeleteFor,
    put(key, bytes = 1) {
      files.set(key, bytes);
    },
    keys() {
      return [...files.keys()].sort();
    },
    async listPrefix(weddingId) {
      const prefix = weddingPrefix(weddingId);
      const out: StoredObject[] = [];
      for (const [key, bytes] of files) if (key.startsWith(prefix)) out.push({ key, bytes });
      return out.sort((a, b) => a.key.localeCompare(b.key));
    },
    async deletePrefix(weddingId) {
      const prefix = weddingPrefix(weddingId);
      if (failDeleteFor.has(weddingId)) throw new Error("Simulované selhání úložiště");
      let deleted = 0;
      for (const key of [...files.keys()]) {
        if (key.startsWith(prefix)) {
          files.delete(key);
          deleted += 1;
        }
      }
      return { deleted };
    },
  };
}
