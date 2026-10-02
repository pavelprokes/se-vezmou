/**
 * Limity a rozměry fotografií na jednom místě (docs/adr/0006-photo-storage.md; hodnoty jsou návrh k potvrzení
 * po měření v betě, OQ-25). Server je vynucuje, rozhraní je jen zrcadlí. Počet fotografií a velikost souboru
 * hlídá i databáze (`app_settings`: `media_max_photos`, `media_max_bytes`).
 */
export const MEDIA_LIMITS = {
  /** Nejvýše tolik fotografií v galerii páru (obrázek karty externí galerie se nepočítá). */
  maxPhotos: 12,
  /** Největší nahrávaný soubor v bajtech (40 MB). */
  maxBytes: 40 * 1024 * 1024,
  /** Největší nahrávaný obrázek v pixelech (100 megapixelů); chrání před „decompression bomb“. */
  maxPixels: 100_000_000,
  /** Šířky variant (px). Nikdy se nezvětšuje nad rozměr originálu. */
  widths: [640, 1280, 1920],
  /** Obrázek karty externí galerie: menší limity i varianty. */
  card: {
    maxBytes: 5 * 1024 * 1024,
    maxPixels: 25_000_000,
    widths: [640, 1280],
  },
  /** Prohlížeč před nahráním volitelně zmenší nejdelší stranu na tuto hodnotu (jen optimalizace rychlosti). */
  preDownscalePx: 4000,
  /** Platnost podepsané adresy pro nahrání originálu. */
  uploadUrlSeconds: 10 * 60,
  /** Časové okno podepsaných adres pro čtení: po dobu okna je adresa beze změny (prohlížeč ji cachuje). */
  deliveryWindowSeconds: 60 * 60,
  /** Kvalita výstupu. */
  quality: { webp: 80, avif: 50 },
} as const;

/** Typy souborů, které se přijímají (podle obsahu, ne přípony). SVG a HEIC se nepřijímají. */
export const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedMime = (typeof ACCEPTED_MIME)[number];

/** Hodnota atributu `accept` pole pro výběr souboru: iOS při výběru z knihovny převede HEIC na JPEG samo. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_MIME.join(",");

export function isAcceptedMime(value: string): value is AcceptedMime {
  return (ACCEPTED_MIME as readonly string[]).includes(value);
}
