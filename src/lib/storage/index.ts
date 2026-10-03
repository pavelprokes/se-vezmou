import "server-only";
import { env as appEnv } from "@/env";
import { isProductionLike, testHatchesAllowed } from "@/lib/test-hatches";
import { createMemoryStorage, type MemoryStorage } from "./memory";
import { createR2Storage, r2ConfigFromEnv } from "./r2";
import {
  StorageError,
  incomingPrefix,
  weddingPrefix,
  type PhotoStorage,
  type StorageKind,
} from "./types";

export {
  IMAGE_FORMATS,
  StorageError,
  StorageTooLargeError,
  incomingKey,
  incomingPrefix,
  mediaPrefix,
  parseKey,
  variantKey,
  weddingPrefix,
} from "./types";
export type { ImageFormat, PhotoStorage, PutTarget, StorageKind, StoredObject } from "./types";

/**
 * Výběr úložiště fotografií (docs/adr/0006-photo-storage.md):
 *  1. proměnné R2 (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, volitelně
 *     `R2_ENDPOINT` a `S3_REGION`) jsou nastavené -> Cloudflare R2;
 *  2. bez nich mimo produkci (vývoj, testy) nebo s výslovným `STORAGE_DRIVER=memory` (e2e testy proti
 *     produkčnímu sestavení, jen s `ALLOW_TEST_HATCHES=1`; nikdy při `VERCEL_ENV=production`) -> úložiště v paměti;
 *  3. jinak (produkce bez R2) -> „nenastavené“ úložiště: výpis a mazání nic nedělají (není co mazat ani
 *     exportovat), ale jakékoli použití fotografií selže srozumitelnou chybou `not_configured`.
 *     Aplikace se tím nikdy nerozbije při startu, funkce fotografií jen hlásí, co chybí.
 */

const MEMORY_KEY = Symbol.for("se-vezmou.memory-storage");

/** Jedna instance na proces (akce, route handlery i testy sdílejí obsah i klíč podpisu). */
function sharedMemory(): MemoryStorage {
  const g = globalThis as unknown as Record<symbol, MemoryStorage | undefined>;
  return (g[MEMORY_KEY] ??= createMemoryStorage());
}

function memoryAllowed(env: Record<string, string | undefined>): boolean {
  // `STORAGE_DRIVER=memory` je testovací vrátka (src/lib/test-hatches.ts): v produkčním sestavení jen s
  // ALLOW_TEST_HATCHES=1, v ostré produkci nikdy. Bez ní se paměť používá jen mimo produkční sestavení.
  if (env.STORAGE_DRIVER === "memory") return testHatchesAllowed(env);
  return !isProductionLike(env);
}

const NOT_CONFIGURED_HINT =
  "Úložiště fotografií není nastavené: doplňte proměnné prostředí R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
  "R2_SECRET_ACCESS_KEY a R2_BUCKET (viz supabase/README.md).";

/**
 * Úložiště bez nastavení. Výpis a mazání jsou prázdné (nic neuchovává), ostatní operace selžou.
 * `missing` jen zpřesní zprávu do logu.
 */
export function createUnconfiguredStorage(missing: readonly string[] = []): PhotoStorage {
  const fail = (): never => {
    throw new StorageError(
      "not_configured",
      missing.length > 0
        ? `${NOT_CONFIGURED_HINT} Chybí: ${missing.join(", ")}.`
        : NOT_CONFIGURED_HINT,
    );
  };
  return {
    kind: "unconfigured",
    async listPrefix(weddingId) {
      weddingPrefix(weddingId);
      return [];
    },
    async deletePrefix(weddingId) {
      weddingPrefix(weddingId);
      incomingPrefix(weddingId);
      return { deleted: 0 };
    },
    presignPut: async () => fail(),
    presignGet: async () => fail(),
    headObject: async () => fail(),
    getObject: async () => fail(),
    putObject: async () => fail(),
    deleteObjects: async () => fail(),
    deleteMedia: async () => fail(),
  };
}

/** Výchozí úložiště do zapojení R2 (zpětná kompatibilita testů): nic neuchovává. */
export const noopStorage: PhotoStorage = createUnconfiguredStorage();

export function resolveStorage(env: Record<string, string | undefined> = appEnv): PhotoStorage {
  const r2 = r2ConfigFromEnv(env);
  if (r2.status === "ok") return createR2Storage(r2.config);
  if (memoryAllowed(env)) return sharedMemory();
  return createUnconfiguredStorage(r2.missing);
}

let override: PhotoStorage | undefined;
let cached: PhotoStorage | undefined;

/** Jen pro testy: nahradí úložiště (null vrací výchozí). */
export function setStorage(storage: PhotoStorage | null): void {
  override = storage ?? undefined;
  cached = undefined;
}

export function getStorage(): PhotoStorage {
  if (override) return override;
  return (cached ??= resolveStorage());
}

/** Druh úložiště, které se právě používá (UI podle něj ví, zda jsou fotografie k dispozici). */
export function storageKind(): StorageKind {
  return getStorage().kind;
}

/** Úložiště v paměti (vývojová cesta `/api/dev-storage`), jinak `null`. */
export function getMemoryStorage(): MemoryStorage | null {
  const storage = getStorage();
  return storage.kind === "memory" ? (storage as MemoryStorage) : null;
}
