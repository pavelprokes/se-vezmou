import sharp from "sharp";
import { MEDIA_LIMITS } from "./limits";

/**
 * Zpracování nahraného obrázku na serveru (docs/adr/0006-photo-storage.md, bod 4): autoritativní, na
 * klientovi nezávislé.
 *  - skutečný typ se pozná z OBSAHU (JPEG, PNG, WebP), nikdy z přípony ani `Content-Type`; SVG, HEIC, GIF a
 *    cokoli jiného se odmítne,
 *  - velikost v pixelech se kontroluje z hlavičky ještě před dekódováním a `sharp` má vlastní strop
 *    (`limitInputPixels`),
 *  - otočení podle EXIF, převod do sRGB, ODSTRANĚNÍ VŠECH METADAT (EXIF, GPS, ICC, XMP; výchozí chování
 *    `sharp`, hlídá test),
 *  - výstup 640, 1280 a 1920 px ve WebP a AVIF, nikdy nad rozměr originálu.
 * Čistá funkce nad bajty: nic nečte ani nezapisuje mimo paměť.
 */

sharp.cache(false);

export type MediaFailure =
  "empty" | "unsupported_type" | "heic" | "too_many_pixels" | "corrupt" | "too_large";

export class MediaError extends Error {
  constructor(readonly code: MediaFailure) {
    super(code);
    this.name = "MediaError";
  }
}

export type SniffedType = "jpeg" | "png" | "webp";

/** Skutečný typ podle prvních bajtů; `heic` pro rodinu HEIF (iPhone), jinak `null`. */
export function sniffImageType(input: Uint8Array): SniffedType | "heic" | null {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff)
    return "jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (input.length >= 8 && png.every((byte, i) => input[i] === byte)) return "png";
  const ascii = (from: number, to: number) =>
    Buffer.from(input.subarray(from, to)).toString("latin1");
  if (input.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (input.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return "heic";
    }
  }
  return null;
}

export type ImageFormat = "webp" | "avif";

export type ProcessedVariant = {
  width: number;
  height: number;
  format: ImageFormat;
  bytes: number;
  data: Buffer;
};

export type ProcessedImage = {
  /** Skutečný typ vstupu (`jpeg`, `png`, `webp`). */
  sourceType: SniffedType;
  /** Rozměry originálu po otočení podle EXIF. */
  originalWidth: number;
  originalHeight: number;
  /** Největší varianta: jí odpovídají rozměry média v databázi (poměr stran pro `<img width height>`). */
  width: number;
  height: number;
  variants: ProcessedVariant[];
};

/**
 * Šířky variant pro daný originál: cílové šířky nepřesahující originál; je-li originál menší než největší cíl
 * a výrazně (o víc než 10 %) větší než nejbližší menší varianta, přidá se ještě jeho vlastní šířka, takže
 * největší varianta nikdy nezahodí podrobnosti malého originálu. Nikdy se nezvětšuje.
 */
export function variantWidths(
  originalWidth: number,
  targets: readonly number[] = MEDIA_LIMITS.widths,
): number[] {
  const sorted = [...targets].sort((a, b) => a - b);
  const widths = sorted.filter((w) => w <= originalWidth);
  const largest = sorted[sorted.length - 1];
  const last = widths[widths.length - 1];
  if (originalWidth < largest && (last === undefined || originalWidth > last * 1.1)) {
    widths.push(originalWidth);
  }
  return widths;
}

export type ProcessOptions = {
  maxPixels?: number;
  widths?: readonly number[];
  formats?: readonly ImageFormat[];
};

function classify(error: unknown): MediaError {
  if (error instanceof MediaError) return error;
  const message = error instanceof Error ? error.message : "";
  if (/pixel limit/i.test(message)) return new MediaError("too_many_pixels");
  return new MediaError("corrupt");
}

export async function processImage(
  input: Buffer,
  options: ProcessOptions = {},
): Promise<ProcessedImage> {
  const maxPixels = options.maxPixels ?? MEDIA_LIMITS.maxPixels;
  const targets = options.widths ?? MEDIA_LIMITS.widths;
  const formats = options.formats ?? (["webp", "avif"] as const);
  if (input.length === 0) throw new MediaError("empty");

  const sniffed = sniffImageType(input);
  if (sniffed === "heic") throw new MediaError("heic");
  if (sniffed === null) throw new MediaError("unsupported_type");

  try {
    const open = () =>
      sharp(input, {
        limitInputPixels: maxPixels,
        // Poškozený nebo useknutý soubor selže; varování (např. nadbytečné bajty u JPEG z foťáku) nevadí.
        failOn: "truncated",
        // Jen první snímek (animované WebP se nezpracovávají jako animace).
        pages: 1,
      });

    const meta = await open().metadata();
    if (!meta.width || !meta.height) throw new MediaError("corrupt");
    if (meta.width * meta.height > maxPixels) throw new MediaError("too_many_pixels");
    // Orientace EXIF 5 až 8 prohazuje strany.
    const swap = (meta.orientation ?? 1) >= 5;
    const originalWidth = swap ? meta.height : meta.width;
    const originalHeight = swap ? meta.width : meta.height;

    const widths = variantWidths(originalWidth, targets);
    const maxWidth = widths[widths.length - 1] ?? originalWidth;

    // Jedno dekódování originálu: otočit, převést do sRGB (původní profil se při odstranění metadat promítne
    // do pixelů) a zmenšit na největší cílovou šířku; menší varianty vznikají už z tohoto mezikroku.
    const base = await open()
      .rotate()
      .toColourspace("srgb")
      .resize({ width: maxWidth, withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const raw = { width: base.info.width, height: base.info.height, channels: base.info.channels };

    const variants: ProcessedVariant[] = [];
    for (const width of widths) {
      for (const format of formats) {
        const pipeline = sharp(base.data, { raw }).resize({
          width: Math.min(width, raw.width),
          withoutEnlargement: true,
        });
        // Žádné `withMetadata`/`keepMetadata`: výstup nenese EXIF, GPS, XMP ani ICC profil.
        const encoded =
          format === "webp"
            ? pipeline.webp({ quality: MEDIA_LIMITS.quality.webp, effort: 4 })
            : pipeline.avif({ quality: MEDIA_LIMITS.quality.avif, effort: 4 });
        const out = await encoded.toBuffer({ resolveWithObject: true });
        variants.push({
          width: out.info.width,
          height: out.info.height,
          format,
          bytes: out.data.length,
          data: out.data,
        });
      }
    }
    const largest = variants.reduce((a, b) => (b.width > a.width ? b : a));
    return {
      sourceType: sniffed,
      originalWidth,
      originalHeight,
      width: largest.width,
      height: largest.height,
      variants,
    };
  } catch (error) {
    throw classify(error);
  }
}
