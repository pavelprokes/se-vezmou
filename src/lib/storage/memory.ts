import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  StorageTooLargeError,
  assertKey,
  incomingKey,
  incomingPrefix,
  mediaPrefix,
  parseKey,
  weddingPrefix,
  StorageError,
  type PhotoStorage,
  type PutTarget,
  type StoredObject,
} from "./types";

/**
 * Úložiště v paměti: pro vývoj bez R2, e2e testy a jednotkové testy. Soubory se ukládají pod stejnými klíči
 * jako v R2. Selhání mazání jde nasimulovat (`failDeleteFor`), aby šlo ověřit, že úloha retence web neoznačí
 * za vymazaný.
 *
 * „Podepsané“ adresy míří na interní cestu aplikace `/api/dev-storage` (jen při tomto úložišti), takže celý
 * tok nahrání a doručení jde projít v prohlížeči bez Cloudflare. Podpis je HMAC nad metodou, klíčem a vypršením
 * s náhodným klíčem procesu: adresa neprozradí obsah a po vypršení nefunguje.
 */
export type MemoryStorage = PhotoStorage & {
  /** Uloží objekt (velikost nebo obsah); pro testy. */
  put(key: string, content?: number | Buffer): void;
  keys(): string[];
  /** Mazání těchto svateb selže (dokud se nezavolá `failDeleteFor.clear()`). */
  failDeleteFor: Set<string>;
  /** Ověří podpis adresy z `presignPut` a `presignGet` (cesta `/api/dev-storage`). */
  verify(input: {
    method: "GET" | "PUT";
    key: string;
    expires: number;
    signature: string;
    now?: Date;
  }): boolean;
  /** Obsah objektu bez limitu (vývojová cesta `/api/dev-storage`). */
  contentType(key: string): string | undefined;
};

type Stored = { bytes: number; body?: Buffer; contentType?: string; cacheControl?: string };

export const DEV_STORAGE_PATH = "/api/dev-storage";

export function createMemoryStorage(options: { secret?: Buffer } = {}): MemoryStorage {
  const files = new Map<string, Stored>();
  const failDeleteFor = new Set<string>();
  const secret = options.secret ?? randomBytes(32);

  const sign = (method: string, key: string, expires: number) =>
    createHmac("sha256", secret).update(`${method}\n${key}\n${expires}`).digest("hex");

  const signedUrl = (method: "GET" | "PUT", key: string, expires: number, extra = "") =>
    `${DEV_STORAGE_PATH}?key=${encodeURIComponent(key)}&expires=${expires}&sig=${sign(method, key, expires)}${extra}`;

  const storage: MemoryStorage = {
    kind: "memory",
    failDeleteFor,
    put(key, content = 1) {
      if (typeof content === "number") files.set(key, { bytes: content });
      else files.set(key, { bytes: content.length, body: content });
    },
    keys() {
      return [...files.keys()].sort();
    },
    contentType: (key) => files.get(key)?.contentType,
    verify({ method, key, expires, signature, now = new Date() }) {
      if (!Number.isFinite(expires) || expires * 1000 < now.getTime()) return false;
      const expected = Buffer.from(sign(method, key, expires), "hex");
      let given: Buffer;
      try {
        given = Buffer.from(signature, "hex");
      } catch {
        return false;
      }
      return given.length === expected.length && timingSafeEqual(given, expected);
    },

    async listPrefix(weddingId) {
      const prefix = weddingPrefix(weddingId);
      const out: StoredObject[] = [];
      for (const [key, file] of files) {
        if (key.startsWith(prefix)) out.push({ key, bytes: file.bytes });
      }
      return out.sort((a, b) => a.key.localeCompare(b.key));
    },
    async deletePrefix(weddingId) {
      const prefixes = [weddingPrefix(weddingId), incomingPrefix(weddingId)];
      if (failDeleteFor.has(weddingId.toLowerCase()) || failDeleteFor.has(weddingId)) {
        throw new Error("Simulované selhání úložiště");
      }
      let deleted = 0;
      for (const key of [...files.keys()]) {
        if (prefixes.some((prefix) => key.startsWith(prefix))) {
          files.delete(key);
          deleted += 1;
        }
      }
      return { deleted };
    },

    async presignPut(key, { contentType, expiresInSeconds }): Promise<PutTarget> {
      if (!parseKey(key)?.incoming) {
        throw new StorageError("invalid_key", "Nahrávat lze jen do karantény");
      }
      const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
      return {
        url: signedUrl("PUT", key, expires),
        method: "PUT",
        headers: { "Content-Type": contentType },
        expiresInSeconds,
      };
    },
    async presignGet(key, { windowSeconds, now = new Date(), downloadName }) {
      assertKey(key);
      const window = Math.max(60, Math.floor(windowSeconds));
      const start = Math.floor(now.getTime() / 1000 / window) * window;
      const extra = downloadName ? `&name=${encodeURIComponent(downloadName)}` : "";
      return signedUrl("GET", key, start + window * 2, extra);
    },
    async headObject(key) {
      assertKey(key);
      const file = files.get(key);
      return file ? { bytes: file.bytes } : null;
    },
    async getObject(key, { maxBytes }) {
      assertKey(key);
      const file = files.get(key);
      if (!file) return null;
      if (file.bytes > maxBytes) throw new StorageTooLargeError();
      return file.body ?? Buffer.alloc(file.bytes);
    },
    async putObject(key, body, { contentType, cacheControl }) {
      assertKey(key);
      files.set(key, { bytes: body.length, body, contentType, cacheControl });
    },
    async deleteObjects(keys) {
      for (const key of keys) assertKey(key);
      for (const key of keys) {
        const parsed = parseKey(key);
        if (parsed && failDeleteFor.has(parsed.weddingId)) {
          throw new Error("Simulované selhání úložiště");
        }
        files.delete(key);
      }
    },
    async deleteMedia(weddingId, mediaId) {
      if (failDeleteFor.has(weddingId.toLowerCase()))
        throw new Error("Simulované selhání úložiště");
      files.delete(incomingKey(weddingId, mediaId));
      const prefix = mediaPrefix(weddingId, mediaId);
      for (const key of [...files.keys()]) if (key.startsWith(prefix)) files.delete(key);
    },
  };
  return storage;
}
