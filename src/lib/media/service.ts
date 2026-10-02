import "server-only";
import { RATE_RULES, type RateRule } from "@/auth/config";
import { rateKey } from "@/auth/rate-limit";
import { requireEnv } from "@/env";
import type { AdminIdentity } from "@/lib/db/admin-site";
import {
  adminMediaBegin,
  adminMediaComplete,
  adminMediaDelete,
  adminMediaFail,
  adminMediaGet,
  adminMediaList,
  adminMediaRequest,
  adminMediaUpdate,
  type VariantInput,
} from "@/lib/db/media";
import { rateLimitHit } from "@/lib/db/rpc";
import { DbError } from "@/lib/db/transport";
import {
  StorageError,
  StorageTooLargeError,
  getStorage,
  incomingKey,
  variantKey,
  type PhotoStorage,
} from "@/lib/storage";
import { cleanText } from "@/admin/site/doc";
import { planPhotoExport, presignPhotoDownload } from "@/lib/export/photos";
import { MEDIA_LIMITS, isAcceptedMime } from "./limits";
import { MediaError, processImage } from "./process";
import {
  knownFailure,
  mediaRowSchema,
  parseMediaRows,
  toMediaItem,
  type FailureCode,
  type MediaItem,
} from "./types";
import { z } from "zod";

/**
 * Serverová logika fotografií páru (M7c, docs/adr/0006-photo-storage.md) bez závislosti na Next.js:
 *  1. `requestUpload`: ověří kvótu a limity, založí médium (pending) a vrátí krátkodobě platnou podepsanou
 *     adresu pro PUT do karantény `incoming/{wedding_id}/{media_id}`; bajty neprocházejí Vercelem,
 *  2. `finishUpload`: přečte originál z karantény (se stropem velikosti), pozná skutečný typ, zkontroluje
 *     pixely, otočí podle EXIF, převede do sRGB, odstraní metadata, vytvoří varianty, uloží je pod
 *     `{wedding_id}/{media_id}/{šířka}.{formát}`, smaže originál; chybné objekty maže hned,
 *  3. úprava popisků, mazání (soubory PŘED řádkem), seznam a export.
 * Každá funkce dostává relaci správce z volající Server Action; svatba je vždy ta z relace. Do logu se
 * nedostane obsah, jména souborů ani klíče, jen druh chyby.
 */

async function limited(scope: string, weddingId: string, rule: RateRule): Promise<number | null> {
  const result = await rateLimitHit(
    rateKey(requireEnv("RATE_LIMIT_SECRET"), scope, weddingId),
    rule.limit,
    rule.windowSeconds,
  );
  return result.allowed ? null : result.retryAfter;
}

function reasonOf(error: unknown): string | undefined {
  return error instanceof DbError ? error.reason : undefined;
}

/** Úložiště je k dispozici, nebo `null` (produkce bez R2: hlásí se jasně, ale jen tady, při použití fotografií). */
function usableStorage(): PhotoStorage | null {
  const storage = getStorage();
  if (storage.kind === "unconfigured") {
    console.error(
      "[fotografie] úložiště není nastavené (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)",
    );
    return null;
  }
  return storage;
}

export function storageAvailable(): boolean {
  return getStorage().kind !== "unconfigured";
}

// --- seznam ----------------------------------------------------------------------------------

export async function listMedia(session: AdminIdentity): Promise<MediaItem[]> {
  return parseMediaRows(await adminMediaList(session));
}

// --- nahrání ---------------------------------------------------------------------------------

export type RequestUploadResult =
  | {
      status: "ok";
      id: string;
      url: string;
      headers: Record<string, string>;
      expiresInSeconds: number;
    }
  | { status: "quota" }
  | { status: "too_large" }
  | { status: "bad_type" }
  | { status: "not_editable" }
  | { status: "unavailable" }
  | { status: "limited"; retryAfter: number };

const requestSchema = z.object({
  mime: z.string().max(100),
  bytes: z.number().int().min(1),
});

/** Zapomenutá nahrávání (starší než den) se uklidí i v úložišti; selhání nevadí (pravidlo bucketu maže karanténu). */
async function sweepStale(storage: PhotoStorage, weddingId: string, ids: readonly string[]) {
  for (const id of ids) {
    try {
      await storage.deleteMedia(weddingId, id);
    } catch {
      console.error("[fotografie] zapomenuté nahrávání se nepodařilo smazat z úložiště");
    }
  }
}

export async function requestUpload(
  session: AdminIdentity,
  input: unknown,
): Promise<RequestUploadResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success || !isAcceptedMime(parsed.data.mime)) return { status: "bad_type" };
  if (parsed.data.bytes > MEDIA_LIMITS.maxBytes) return { status: "too_large" };

  const storage = usableStorage();
  if (!storage) return { status: "unavailable" };

  const retry = await limited(
    "media-upload-wedding",
    session.weddingId,
    RATE_RULES.mediaUploadWedding,
  );
  if (retry !== null) return { status: "limited", retryAfter: retry };

  let created: { id: string; stale: string[] };
  try {
    created = await adminMediaRequest(session, {
      kind: "photo",
      mime: parsed.data.mime,
      bytes: parsed.data.bytes,
    });
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "media_quota") return { status: "quota" };
    if (reason === "media_too_large") return { status: "too_large" };
    if (reason === "site_not_editable") return { status: "not_editable" };
    if (reason === "invalid_payload") return { status: "bad_type" };
    throw error;
  }
  await sweepStale(storage, session.weddingId, created.stale);
  return presignFor(session, storage, created.id, parsed.data.mime);
}

async function presignFor(
  session: AdminIdentity,
  storage: PhotoStorage,
  id: string,
  mime: string,
): Promise<RequestUploadResult> {
  try {
    const target = await storage.presignPut(incomingKey(session.weddingId, id), {
      contentType: mime,
      expiresInSeconds: MEDIA_LIMITS.uploadUrlSeconds,
    });
    return {
      status: "ok",
      id,
      url: target.url,
      headers: target.headers,
      expiresInSeconds: target.expiresInSeconds,
    };
  } catch (error) {
    // Podpis se nepodařil (chybné klíče R2): médium se označí za chybné, ať nedrží kvótu.
    await adminMediaFail(session, id, "storage").catch(() => undefined);
    console.error(
      "[fotografie] podepsání adresy pro nahrání selhalo",
      error instanceof Error ? error.name : "",
    );
    return { status: "unavailable" };
  }
}

const renewSchema = z.object({ id: z.guid(), mime: z.string().max(100) });

/**
 * Nová podepsaná adresa pro už založené médium (adresa vypršela nebo nahrávání selhalo na síti): médium dál
 * drží svou kvótu, nezakládá se druhé. Typ obsahu v hlavičce podpis nepodepisuje a o typu rozhoduje obsah
 * souboru, proto ho posílá klient znovu.
 */
export async function renewUpload(
  session: AdminIdentity,
  input: unknown,
): Promise<RequestUploadResult | { status: "not_found" }> {
  const parsed = renewSchema.safeParse(input);
  if (!parsed.success || !isAcceptedMime(parsed.data.mime)) return { status: "not_found" };
  const storage = usableStorage();
  if (!storage) return { status: "unavailable" };
  const retry = await limited(
    "media-upload-wedding",
    session.weddingId,
    RATE_RULES.mediaUploadWedding,
  );
  if (retry !== null) return { status: "limited", retryAfter: retry };
  const row = mediaRowSchema.nullable().parse(await adminMediaGet(session, parsed.data.id));
  if (!row || row.status !== "pending" || row.kind !== "photo") return { status: "not_found" };
  return presignFor(session, storage, parsed.data.id, parsed.data.mime);
}

// --- zpracování ------------------------------------------------------------------------------

export type FinishUploadResult =
  | { status: "ok"; item: MediaItem }
  | { status: "failed"; code: FailureCode }
  | { status: "busy" }
  | { status: "not_found" }
  | { status: "unavailable" }
  | { status: "limited"; retryAfter: number };

const VARIANT_CACHE = "private, max-age=3600";

type Begun = { id: string; kind: "photo" | "card" };

/**
 * Společné zpracování pro fotografie z prohlížeče (originál v karanténě) i obrázek karty (stažený serverem):
 * `load` vrací bajty originálu. Při jakékoli chybě se smažou originál i případně zapsané varianty a médium se
 * označí za chybné s kódem (bez textu ze souboru).
 */
async function processMedia(
  session: AdminIdentity,
  storage: PhotoStorage,
  media: Begun,
  load: () => Promise<Buffer | null>,
): Promise<{ ok: true; item: MediaItem } | { ok: false; code: FailureCode }> {
  const weddingId = session.weddingId;
  const fail = async (code: FailureCode) => {
    // Chybné objekty se mažou hned (originál s polohou nesmí ležet v úložišti déle, než je nutné).
    try {
      await storage.deleteMedia(weddingId, media.id);
    } catch {
      console.error("[fotografie] chybný objekt se nepodařilo smazat z úložiště");
    }
    await adminMediaFail(session, media.id, code).catch(() => undefined);
    return { ok: false as const, code };
  };

  const isCard = media.kind === "card";
  const limits = isCard ? MEDIA_LIMITS.card : MEDIA_LIMITS;
  let input: Buffer | null;
  try {
    input = await load();
  } catch (error) {
    return fail(error instanceof StorageTooLargeError ? "too_large" : "storage");
  }
  if (!input) return fail("missing_file");
  if (input.length > limits.maxBytes) return fail("too_large");

  let processed;
  try {
    processed = await processImage(input, {
      maxPixels: limits.maxPixels,
      widths: limits.widths,
    });
  } catch (error) {
    if (error instanceof MediaError) return fail(error.code satisfies FailureCode);
    console.error(
      "[fotografie] zpracování obrázku selhalo",
      error instanceof Error ? error.name : "",
    );
    return fail("internal");
  }

  const variants: VariantInput[] = processed.variants.map((variant) => ({
    width: variant.width,
    height: variant.height,
    format: variant.format,
    bytes: variant.bytes,
    key: variantKey(weddingId, media.id, variant.width, variant.format),
  }));
  try {
    await Promise.all(
      processed.variants.map((variant, index) =>
        storage.putObject(variants[index].key, variant.data, {
          contentType: variant.format === "avif" ? "image/avif" : "image/webp",
          cacheControl: VARIANT_CACHE,
        }),
      ),
    );
  } catch {
    return fail("storage");
  }

  let item: MediaItem;
  try {
    item = toMediaItem(
      mediaRowSchema.parse(
        await adminMediaComplete(session, {
          mediaId: media.id,
          width: processed.width,
          height: processed.height,
          variants,
        }),
      ),
    );
  } catch (error) {
    console.error(
      "[fotografie] dokončení zpracování selhalo",
      error instanceof Error ? error.name : "",
    );
    return fail("internal");
  }

  // Originál se po úspěšném zpracování maže (pár má originál u sebe). Selhání nevadí: karanténu maže i pravidlo
  // bucketu po jednom dni.
  try {
    await storage.deleteObjects([incomingKey(weddingId, media.id)]);
  } catch {
    console.error("[fotografie] originál v karanténě se nepodařilo smazat");
  }
  return { ok: true, item };
}

export async function finishUpload(
  session: AdminIdentity,
  mediaId: unknown,
): Promise<FinishUploadResult> {
  const id = z.guid().safeParse(mediaId);
  if (!id.success) return { status: "not_found" };
  const storage = usableStorage();
  if (!storage) return { status: "unavailable" };

  const retry = await limited(
    "media-process-wedding",
    session.weddingId,
    RATE_RULES.mediaProcessWedding,
  );
  if (retry !== null) return { status: "limited", retryAfter: retry };

  const current = mediaRowSchema.nullable().parse(await adminMediaGet(session, id.data));
  if (!current || current.kind !== "photo") return { status: "not_found" };
  // Opakované volání po dokončení (výpadek odpovědi) vrátí hotové médium, ne chybu.
  if (current.status === "ready") return { status: "ok", item: toMediaItem(current) };
  if (current.status === "failed")
    return { status: "failed", code: knownFailure(current.failure_code) };

  let begun: Begun;
  try {
    const row = await adminMediaBegin(session, id.data);
    begun = { id: row.id, kind: row.kind };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "media_busy") return { status: "busy" };
    if (reason === "media_not_found" || reason === "media_not_pending") {
      return { status: "not_found" };
    }
    throw error;
  }

  const key = incomingKey(session.weddingId, begun.id);
  const outcome = await processMedia(session, storage, begun, async () => {
    const head = await storage.headObject(key);
    if (!head) return null;
    if (head.bytes > MEDIA_LIMITS.maxBytes) throw new StorageTooLargeError();
    return storage.getObject(key, { maxBytes: MEDIA_LIMITS.maxBytes });
  });
  return outcome.ok
    ? { status: "ok", item: outcome.item }
    : { status: "failed", code: outcome.code };
}

/**
 * Obrázek karty externí galerie: server stáhl obrázek z Open Graph cíle (`og.ts`), tady se založí médium druhu
 * `card`, projde STEJNÝM zpracováním jako fotografie (typ podle obsahu, pixely, překódování, bez metadat) a uloží se.
 * Vrací identifikátor média, nebo `null` (úložiště není nastavené, obrázek se nezpracoval); nikdy nevyhodí.
 */
export async function storeCardImage(
  session: AdminIdentity,
  image: { data: Buffer; contentType: string },
): Promise<string | null> {
  if (!isAcceptedMime(image.contentType)) return null;
  const storage = getStorage();
  if (storage.kind === "unconfigured") return null;
  try {
    const created = await adminMediaRequest(session, {
      kind: "card",
      mime: image.contentType,
      bytes: image.data.length,
    });
    await sweepStale(storage, session.weddingId, created.stale);
    const row = await adminMediaBegin(session, created.id);
    const outcome = await processMedia(
      session,
      storage,
      { id: row.id, kind: "card" },
      async () => image.data,
    );
    return outcome.ok ? outcome.item.id : null;
  } catch (error) {
    console.error(
      "[fotografie] obrázek karty se nepodařilo uložit",
      error instanceof Error ? error.name : "",
    );
    return null;
  }
}

/**
 * Po uložení nového obrázku karty zůstanou jen dva nejnovější (současný a předchozí, na který může ještě
 * odkazovat zveřejněná verze), starší se smažou (soubory, potom řádky).
 */
export async function pruneCardImages(session: AdminIdentity, keep = 2): Promise<void> {
  try {
    const cards = (await listMedia(session)).filter(
      (item) => item.kind === "card" && item.status !== "pending" && item.status !== "processing",
    );
    // Seznam je podle vzniku vzestupně: nejnovější jsou na konci.
    for (const item of cards.slice(0, Math.max(0, cards.length - keep))) {
      await deleteMedia(session, item.id);
    }
  } catch {
    console.error("[fotografie] starý obrázek karty se nepodařilo uklidit");
  }
}

// --- popisek, mazání --------------------------------------------------------------------------

const updateSchema = z.object({
  id: z.guid(),
  alt: z
    .object({ cs: z.string().max(300).optional(), en: z.string().max(300).optional() })
    .strict()
    .nullable(),
  decorative: z.boolean(),
});

export type UpdateMediaResult =
  | { status: "ok"; item: MediaItem }
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "limited"; retryAfter: number };

export async function updateMedia(
  session: AdminIdentity,
  input: unknown,
): Promise<UpdateMediaResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const retry = await limited("media-edit-wedding", session.weddingId, RATE_RULES.mediaEditWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    const alt = parsed.data.alt ? cleanText(parsed.data.alt) : null;
    const row = await adminMediaUpdate(session, parsed.data.id, {
      alt: alt as Record<string, string> | null,
      decorative: parsed.data.decorative,
    });
    return { status: "ok", item: toMediaItem(mediaRowSchema.parse(row)) };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "media_not_found" || reason === "media_not_editable") {
      return { status: "not_found" };
    }
    if (reason === "invalid_payload") return { status: "invalid" };
    throw error;
  }
}

export type DeleteMediaResult =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "unavailable" }
  | { status: "limited"; retryAfter: number };

/**
 * Smazání: nejdřív soubory v úložišti (originál i všechny varianty), teprve potom řádek. Selhání mazání souborů
 * řádek nesmaže, takže jde zopakovat a nezůstanou soubory bez záznamu. Fotografie zmizí z webu hned (doručení ji
 * přestane podávat a web ji vyřadí ze snímku), i když nová verze ještě nebyla zveřejněna.
 */
export async function deleteMedia(
  session: AdminIdentity,
  mediaId: unknown,
): Promise<DeleteMediaResult> {
  const id = z.guid().safeParse(mediaId);
  if (!id.success) return { status: "not_found" };
  const retry = await limited("media-edit-wedding", session.weddingId, RATE_RULES.mediaEditWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };

  const row = mediaRowSchema.nullable().parse(await adminMediaGet(session, id.data));
  if (!row) return { status: "not_found" };
  const storage = getStorage();
  if (storage.kind === "unconfigured") {
    // Bez úložiště nelze smazat soubory: hotové médium by o ně přišlo bez vědomí; nehotové nemá žádné soubory.
    if (row.status === "ready") {
      usableStorage();
      return { status: "unavailable" };
    }
  } else {
    try {
      await storage.deleteMedia(session.weddingId, id.data);
    } catch (error) {
      console.error(
        "[fotografie] soubory se nepodařilo smazat z úložiště",
        error instanceof StorageError ? error.code : "",
      );
      return { status: "unavailable" };
    }
  }
  try {
    await adminMediaDelete(session, id.data);
  } catch (error) {
    if (reasonOf(error) === "media_not_found") return { status: "not_found" };
    throw error;
  }
  return { status: "ok" };
}

// --- export --------------------------------------------------------------------------------------

export type PhotoExportResult =
  | { status: "ok"; files: { name: string; url: string; bytes: number; width: number }[] }
  | { status: "empty" }
  | { status: "unavailable" }
  | { status: "limited"; retryAfter: number };

/**
 * Export fotografií před vypršením webu (FR-LC-2): odkazy ke stažení největší varianty každé fotografie, jen pro
 * přihlášeného správce své svatby (`planPhotoExport` čte z úložiště předponu této svatby). Pořadí a názvy souborů
 * (`foto-01.webp`, …) odpovídají pořadí nahrání.
 */
export async function exportPhotos(session: AdminIdentity): Promise<PhotoExportResult> {
  const retry = await limited(
    "media-export-wedding",
    session.weddingId,
    RATE_RULES.mediaExportWedding,
  );
  if (retry !== null) return { status: "limited", retryAfter: retry };
  const plan = await planPhotoExport(session.weddingId);
  if (plan.status === "not_available") {
    usableStorage();
    return { status: "unavailable" };
  }
  if (plan.status === "empty") return { status: "empty" };

  // Pořadí podle vzniku fotografií v databázi; soubory bez záznamu (nemělo by nastat) na konec.
  const order = (await listMedia(session))
    .filter((item) => item.kind === "photo")
    .map((item) => item.id);
  const rank = (id: string) => {
    const index = order.indexOf(id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const files = [...plan.files]
    .filter((file) => order.includes(file.mediaId))
    .sort((a, b) => rank(a.mediaId) - rank(b.mediaId));
  if (files.length === 0) return { status: "empty" };
  const pad = String(files.length).length < 2 ? 2 : String(files.length).length;
  return {
    status: "ok",
    files: await Promise.all(
      files.map((file, index) =>
        presignPhotoDownload(file, `foto-${String(index + 1).padStart(pad, "0")}.${file.format}`),
      ),
    ),
  };
}
