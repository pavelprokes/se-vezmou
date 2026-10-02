import { z } from "zod";
import { i18nTextSchema, type I18nText } from "@/site/i18n-text";

/**
 * Tvar média tak, jak ho vrací databáze (`admin_media_list`) a jak ho zná rozhraní správy. Bez klíčů v úložišti:
 * ty zná jen server. Modul je čistý (použije ho server i prohlížeč).
 */

export const mediaRowSchema = z.object({
  id: z.guid(),
  kind: z.enum(["photo", "card"]),
  status: z.enum(["pending", "processing", "ready", "failed"]),
  failure_code: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  bytes: z.number().nullable(),
  alt: i18nTextSchema.nullable(),
  decorative: z.boolean(),
  created_at: z.string(),
  variants: z.array(
    z.object({
      width: z.number().int(),
      height: z.number().int(),
      format: z.enum(["avif", "webp"]),
      bytes: z.number(),
    }),
  ),
});
export type MediaRow = z.infer<typeof mediaRowSchema>;

export type MediaStatus = MediaRow["status"];

export interface MediaItem {
  id: string;
  kind: "photo" | "card";
  status: MediaStatus;
  failureCode: string | null;
  /** Rozměry největší varianty (poměr stran pro `<img width height>`); `null`, dokud se nezpracuje. */
  width: number | null;
  height: number | null;
  bytes: number | null;
  alt: I18nText | null;
  decorative: boolean;
  /** Šířky dostupných variant (vzestupně), každá je ve WebP i AVIF. */
  widths: number[];
}

export function toMediaItem(row: MediaRow): MediaItem {
  const widths = [
    ...new Set(row.variants.filter((v) => v.format === "webp").map((v) => v.width)),
  ].sort((a, b) => a - b);
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    failureCode: row.failure_code,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    alt: row.alt,
    decorative: row.decorative,
    widths,
  };
}

export function parseMediaRows(raw: unknown): MediaItem[] {
  return z
    .array(mediaRowSchema)
    .parse(raw ?? [])
    .map(toMediaItem);
}

/** Adresa varianty na hostiteli webu (nebo správy): `/media/{id}/{šířka}`, formát volitelně `?f=avif|webp`. */
export function mediaSrc(id: string, width: number, format?: "avif" | "webp"): string {
  return `/media/${id}/${width}${format ? `?f=${format}` : ""}`;
}

/** Hotová fotografie (nebo obrázek karty), kterou lze zveřejnit: má alespoň jednu variantu. */
export function isReady(item: MediaItem): boolean {
  return item.status === "ready" && item.widths.length > 0 && item.width !== null;
}

/** Chybové kódy zpracování, které rozhraní umí popsat (jiný kód je obecná chyba). */
export const FAILURE_CODES = [
  "unsupported_type",
  "heic",
  "too_many_pixels",
  "too_large",
  "corrupt",
  "empty",
  "missing_file",
  "storage",
  "expired",
  "internal",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

export function knownFailure(code: string | null): FailureCode {
  return (FAILURE_CODES as readonly string[]).includes(code ?? "")
    ? (code as FailureCode)
    : "internal";
}
