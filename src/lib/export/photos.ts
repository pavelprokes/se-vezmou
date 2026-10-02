import "server-only";
import { getStorage, parseKey, type StoredObject } from "@/lib/storage";

/**
 * Export fotografií před vypršením webu (FR-LC-2, docs/adr/0006-photo-storage.md): největší zpracovaná varianta
 * každé fotografie ke stažení přes krátkodobě platnou podepsanou adresu, jen po přihlášení správce (žádný veřejný
 * odkaz; `weddingId` pochází z ověřené relace). Archiv se nesestavuje na serveru: u desítek fotografií po
 * několika stech kilobajtech je pro pár i pro Vercel jednodušší a spolehlivější stahovat soubory přímo z úložiště.
 *
 * Výběr jde z úložiště (výpis předpony `{wedding_id}/`), takže export vydá právě to, co v úložišti skutečně je;
 * karanténa `incoming/` se nevypisuje. Při stejné šířce má WebP přednost před AVIF (širší podpora).
 */

export type PlannedPhoto = StoredObject & {
  mediaId: string;
  width: number;
  format: "webp" | "avif";
};

export type PhotoExportPlan =
  { status: "not_available" } | { status: "empty" } | { status: "ready"; files: PlannedPhoto[] };

/** Co by se v exportu fotografií sešlo: největší varianta každého média svatby. */
export async function planPhotoExport(weddingId: string): Promise<PhotoExportPlan> {
  const storage = getStorage();
  // Bez nastaveného úložiště fotografie nejsou k dispozici (v databázi žádné hotové nejsou).
  if (storage.kind === "unconfigured") return { status: "not_available" };

  const best = new Map<string, PlannedPhoto>();
  for (const object of await storage.listPrefix(weddingId)) {
    const parsed = parseKey(object.key);
    const match = /\/(\d+)\.(webp|avif)$/.exec(object.key);
    if (!parsed || parsed.incoming || !match) continue;
    const candidate: PlannedPhoto = {
      ...object,
      mediaId: parsed.mediaId,
      width: Number(match[1]),
      format: match[2] as "webp" | "avif",
    };
    const current = best.get(parsed.mediaId);
    if (
      !current ||
      candidate.width > current.width ||
      (candidate.width === current.width &&
        candidate.format === "webp" &&
        current.format !== "webp")
    ) {
      best.set(parsed.mediaId, candidate);
    }
  }
  const files = [...best.values()].sort((a, b) => a.key.localeCompare(b.key));
  return files.length === 0 ? { status: "empty" } : { status: "ready", files };
}

/** Odkaz ke stažení jedné fotografie (platí řádově desítky minut, stejný v rámci okna). */
export async function presignPhotoDownload(
  file: PlannedPhoto,
  name: string,
): Promise<{ name: string; url: string; bytes: number; width: number }> {
  const url = await getStorage().presignGet(file.key, { windowSeconds: 900, downloadName: name });
  return { name, url, bytes: file.bytes, width: file.width };
}
