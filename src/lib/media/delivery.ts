import "server-only";
import { MEDIA_LIMITS } from "./limits";
import { getStorage } from "@/lib/storage";

/**
 * Doručení fotografií (docs/adr/0006-photo-storage.md, kap. Doručování): web podává obrázky přes vlastní adresu
 * `/media/{media_id}/{šířka}` (formát `?f=avif|webp`, výchozí WebP), která po kontrole svatby a stavu odpoví
 * PŘESMĚROVÁNÍM na čerstvě podepsanou adresu úložiště. V HTML tak není adresa s vypršením a stránku lze cachovat;
 * bajty obrázků jdou z úložiště přímo, ne přes Vercel. Podpis se váže na časové okno, takže je adresa po dobu
 * okna stejná a prohlížeč ji cachuje. Přesměrování má krátké `Cache-Control` a `X-Robots-Tag: noindex`.
 */

export type MediaRequest = { mediaId: string; width: number; format: "avif" | "webp" };

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tvar požadavku z parametrů cesty a dotazu; cokoli jiného je `null` (404). */
export function parseMediaRequest(
  id: string,
  width: string,
  format: string | null,
): MediaRequest | null {
  if (!ID_PATTERN.test(id) || !/^\d{2,4}$/.test(width)) return null;
  const w = Number(width);
  if (w < 16 || w > 4000) return null;
  const f = format ?? "webp";
  if (f !== "webp" && f !== "avif") return null;
  return { mediaId: id.toLowerCase(), width: w, format: f };
}

const NOINDEX = "noindex, nofollow";

/** Prázdná 404 bez nápovědy, co existuje (neznámé, nezveřejněné, smazané i chráněné médium vypadá stejně). */
export function mediaNotFound(): Response {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": NOINDEX,
      "Referrer-Policy": "no-referrer",
    },
  });
}

/** Přesměrování na podepsanou adresu úložiště pro klíč varianty. */
export async function mediaRedirect(key: string): Promise<Response> {
  const location = await getStorage().presignGet(key, {
    windowSeconds: MEDIA_LIMITS.deliveryWindowSeconds,
  });
  return new Response(null, {
    status: 302,
    headers: {
      // Adresa se v prohlížeči nechá pět minut (obrázek sám si cachuje úložiště); `private`, protože fotografie
      // chráněné PINem hostů nesmí skončit ve sdílené mezipaměti. Cookie rozhoduje o výsledku, proto `Vary`.
      Location: location,
      "Cache-Control": "private, max-age=300",
      Vary: "Cookie",
      "X-Robots-Tag": NOINDEX,
      "Referrer-Policy": "no-referrer",
    },
  });
}
