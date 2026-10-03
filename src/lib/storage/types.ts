import { z } from "zod";

/**
 * Rozhraní úložiště fotografií (docs/adr/0006-photo-storage.md). Aplikace smí s úložištěm mluvit jen
 * přes ně: implementace na Cloudflare R2 (S3 API, `r2.ts`), v paměti pro vývoj a testy (`memory.ts`)
 * a „nenastavené“ úložiště (`index.ts`), které v produkci bez proměnných R2 selže srozumitelně, až když
 * se fotografie opravdu použijí.
 *
 * Soubory svatby leží pod předponou `{wedding_id}/` (zpracované varianty `{wedding_id}/{media_id}/{šířka}.{formát}`),
 * nahrané originály čekají v karanténě `incoming/{wedding_id}/{media_id}` (pravidlo bucketu je maže po 1 dni).
 * Všechny operace berou jen identifikátory svatby a média, nikdy volnou předponu: neplatný nebo odvozený klíč
 * by mohl sáhnout na cizí data, proto se identifikátory vždy ověřují jako UUID a klíče jako přesný tvar.
 */

export type StoredObject = {
  /** Úplný klíč souboru včetně předpony `{wedding_id}/`. */
  key: string;
  bytes: number;
};

export type PutTarget = {
  /** Podepsaná adresa pro PUT přímo do úložiště (bajty neprocházejí Vercelem). */
  url: string;
  method: "PUT";
  /** Hlavičky, které musí prohlížeč poslat (např. `Content-Type`). */
  headers: Record<string, string>;
  expiresInSeconds: number;
};

export type StorageKind = "r2" | "memory" | "unconfigured";

export interface PhotoStorage {
  readonly kind: StorageKind;

  /** Soubory svatby (pro export a kontrolu). Nikdy nevypisuje soubory jiné svatby ani karanténu. */
  listPrefix(weddingId: string): Promise<StoredObject[]>;
  /**
   * Smaže všechny soubory svatby: předponu `{wedding_id}/` i karanténu `incoming/{wedding_id}/`. Idempotentní:
   * smazání prázdné předpony uspěje. Při selhání vyhazuje chybu a nesmí smazání označit za provedené: úloha
   * retence pak web NEoznačí za vymazaný a zkusí to znovu (docs/data-model.md kap. 10).
   */
  deletePrefix(weddingId: string): Promise<{ deleted: number }>;

  /**
   * Krátkodobě platná adresa pro PUT originálu do karantény (`incoming/{wedding_id}/{media_id}`). Podpis se váže na
   * přesnou velikost (`bytes`): klient musí poslat přesně tolik bajtů, kolik server schválil.
   */
  presignPut(
    key: string,
    options: { contentType: string; bytes: number; expiresInSeconds: number },
  ): Promise<PutTarget>;
  /**
   * Podepsaná adresa pro čtení. Podpis se váže na časové okno (`windowSeconds`), takže je adresa po dobu okna
   * stejná a prohlížeč ji může cachovat; `downloadName` ji změní na stažení souboru.
   */
  presignGet(
    key: string,
    options: { windowSeconds: number; now?: Date; downloadName?: string },
  ): Promise<string>;
  /** Velikost objektu, nebo `null`, když neexistuje. */
  headObject(key: string): Promise<{ bytes: number } | null>;
  /** Obsah objektu s pevným stropem velikosti (`StorageTooLargeError`), nebo `null`, když neexistuje. */
  getObject(key: string, options: { maxBytes: number }): Promise<Buffer | null>;
  putObject(
    key: string,
    body: Buffer,
    options: { contentType: string; cacheControl?: string },
  ): Promise<void>;
  /** Smaže uvedené objekty (neexistující nevadí). Chyba kteréhokoli kusu je vyhozená chyba. */
  deleteObjects(keys: string[]): Promise<void>;
  /** Smaže originál v karanténě i všechny varianty jednoho média. */
  deleteMedia(weddingId: string, mediaId: string): Promise<void>;
}

/** Chyba úložiště. Zpráva nikdy nenese adresu s podpisem ani klíče. */
export class StorageError extends Error {
  constructor(
    readonly code: "storage_failed" | "not_configured" | "too_large" | "invalid_key",
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export class StorageTooLargeError extends StorageError {
  constructor() {
    super("too_large", "Soubor v úložišti je větší než povolený limit");
  }
}

const uuid = z.guid();

/** Předpona souborů svatby `{wedding_id}/`; neplatný identifikátor je chyba programu. */
export function weddingPrefix(weddingId: string): string {
  if (!uuid.safeParse(weddingId).success) {
    throw new Error("Neplatný identifikátor svatby pro úložiště");
  }
  return `${weddingId.toLowerCase()}/`;
}

/** Předpona karantény svatby `incoming/{wedding_id}/`. */
export function incomingPrefix(weddingId: string): string {
  return `incoming/${weddingPrefix(weddingId)}`;
}

function id(value: string, what: string): string {
  if (!uuid.safeParse(value).success)
    throw new Error(`Neplatný identifikátor ${what} pro úložiště`);
  return value.toLowerCase();
}

/** Klíč nahraného originálu: `incoming/{wedding_id}/{media_id}`. */
export function incomingKey(weddingId: string, mediaId: string): string {
  return `${incomingPrefix(weddingId)}${id(mediaId, "média")}`;
}

/** Předpona variant jednoho média: `{wedding_id}/{media_id}/`. */
export function mediaPrefix(weddingId: string, mediaId: string): string {
  return `${weddingPrefix(weddingId)}${id(mediaId, "média")}/`;
}

export const IMAGE_FORMATS = ["webp", "avif"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

/** Klíč varianty: `{wedding_id}/{media_id}/{šířka}.{formát}`. */
export function variantKey(
  weddingId: string,
  mediaId: string,
  width: number,
  format: ImageFormat,
): string {
  if (!Number.isInteger(width) || width < 1 || width > 10000 || !IMAGE_FORMATS.includes(format)) {
    throw new Error("Neplatná varianta pro úložiště");
  }
  return `${mediaPrefix(weddingId, mediaId)}${width}.${format}`;
}

const KEY_PATTERN =
  /^(?:incoming\/([0-9a-f-]{36})\/([0-9a-f-]{36})|([0-9a-f-]{36})\/([0-9a-f-]{36})\/(\d{1,5})\.(webp|avif))$/;

/**
 * Rozbor klíče; vrací `null` pro cokoli jiného než dva tvary, které aplikace zapisuje (originál v karanténě,
 * varianta). Podpis ani smazání se nikdy neprovede nad klíčem, který tímto nepropadl.
 */
export function parseKey(
  key: string,
): { weddingId: string; mediaId: string; incoming: boolean } | null {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  const weddingId = (match[1] ?? match[3]).toLowerCase();
  const mediaId = (match[2] ?? match[4]).toLowerCase();
  if (!uuid.safeParse(weddingId).success || !uuid.safeParse(mediaId).success) return null;
  return { weddingId, mediaId, incoming: match[1] !== undefined };
}

export function assertKey(key: string): void {
  if (!parseKey(key)) throw new StorageError("invalid_key", "Neplatný klíč objektu v úložišti");
}
