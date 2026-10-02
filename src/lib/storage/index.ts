import "server-only";
import { weddingPrefix, type PhotoStorage } from "./types";

export { weddingPrefix };
export type { PhotoStorage, StoredObject } from "./types";

/**
 * Výchozí úložiště do příchodu implementace R2 (M7c): nic neuchovává, takže není co mazat ani exportovat.
 * Úloha retence ho volá stejně jako skutečné úložiště; po M7c stačí vrátit z `getStorage` klienta R2.
 *
 * TODO(M7c): `getStorage()` má vracet klienta Cloudflare R2 (S3 API; `listPrefix` a `deletePrefix` s předponou
 * `{wedding_id}/` po stránkách, `DeleteObjects` po 1000 klíčích, chyba jakéhokoli kusu = vyhozená chyba).
 */
export const noopStorage: PhotoStorage = {
  async listPrefix(weddingId) {
    weddingPrefix(weddingId);
    return [];
  },
  async deletePrefix(weddingId) {
    weddingPrefix(weddingId);
    return { deleted: 0 };
  },
};

let override: PhotoStorage | undefined;

/** Jen pro testy: nahradí úložiště (null vrací výchozí). */
export function setStorage(storage: PhotoStorage | null): void {
  override = storage ?? undefined;
}

export function getStorage(): PhotoStorage {
  return override ?? noopStorage;
}
