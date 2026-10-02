import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import sharp from "sharp";
import type { EditorBlock } from "../../src/admin/site/doc";
import { withDb } from "./db";
import { openBlock, openEditor } from "./admin";

/**
 * Pomocníci e2e fotografií (M7c). Úložiště je v paměti aplikace (`STORAGE_DRIVER=memory` v `playwright.config.ts`),
 * takže se celý tok projde bez Cloudflare: prohlížeč nahrává na podepsanou adresu `/api/dev-storage`, server
 * zpracuje originál přes `sharp` a doručení jde přesměrováním na stejnou cestu.
 */

export const TAJNA_ZNACKA = "TajnaZnackaFotoaparatu";

/** JPEG s EXIF (výrobce foťáku) a GPS polohou: server ji musí odstranit. */
export async function jpegWithGps(width = 3000, height = 2000, color = { r: 120, g: 70, b: 40 }) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .withExif({
      IFD0: { Make: TAJNA_ZNACKA },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "50/1 5/1 1234/100",
        GPSLongitudeRef: "E",
        GPSLongitude: "14/1 25/1 4321/100",
      },
    })
    .toBuffer();
}

export const file = (name: string, mimeType: string, buffer: Buffer) => ({
  name,
  mimeType,
  buffer,
});

/** Zapne blok galerie už při zakládání webu (snímek zůstane prázdný, fotografie přibudou v editoru). */
export const enableGallery = (blocks: EditorBlock[]): EditorBlock[] =>
  blocks.map((b) => (b.type === "gallery" ? ({ ...b, enabled: true } as EditorBlock) : b));

/** Otevře editor se sekcí Fotografie rozbalenou. */
export async function openGallery(page: Page): Promise<Locator> {
  await openEditor(page);
  return openBlock(page, "gallery", "Fotografie");
}

export const photoGroup = (gallery: Locator, n: number, total: number) =>
  gallery.getByRole("group", { name: new RegExp(`^Fotografie ${n}\\sz\\s${total}$`) });

/** Vybere soubory v poli „Vybrat fotografie“. */
export async function chooseFiles(
  gallery: Locator,
  files: { name: string; mimeType: string; buffer: Buffer }[],
) {
  await gallery.getByLabel("Vybrat fotografie").setInputFiles(files);
}

/** Počká, až fronta ohlásí „Hotovo“ pro daný počet souborů. */
export async function expectUploaded(gallery: Locator, count: number) {
  const queue = gallery.getByRole("list", { name: "Fronta nahrávání" });
  await expect(queue.getByText("Hotovo", { exact: true })).toHaveCount(count, { timeout: 90_000 });
}

export interface MediaRow {
  id: string;
  kind: string;
  status: string;
  failure_code: string | null;
  decorative: boolean;
  alt: Record<string, string> | null;
  storage_path: string;
  width: number | null;
  variants: number;
}

export async function mediaRows(weddingId: string): Promise<MediaRow[]> {
  return withDb(async (db) => {
    const result = await db.query<MediaRow>(
      `select m.id, m.kind, m.status, m.failure_code, m.decorative, m.alt, m.storage_path, m.width,
              (select count(*)::int from se_vezmou.media_variants v where v.media_id = m.id) as variants
         from se_vezmou.media m where m.wedding_id = $1 order by m.created_at, m.id`,
      [weddingId],
    );
    return result.rows;
  });
}

/** Identifikátor média z adresy `/media/{id}/…` obrázku na stránce. */
export function mediaIdFromSrc(src: string | null): string {
  const match = /\/media\/([0-9a-f-]{36})\//.exec(src ?? "");
  if (!match) throw new Error(`Adresa nenese identifikátor média: ${src}`);
  return match[1];
}
