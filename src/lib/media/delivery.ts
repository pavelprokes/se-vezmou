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

/**
 * Mezipaměť přesměrování. Veřejně viditelné médium (požadavek bez relace hosta po PINu, tedy výsledek databáze
 * pro roli `visitor`: médium je ve zveřejněném snímku) smí do sdílené mezipaměti (CDN) na pět minut a dalších
 * deset minut se smí servírovat zastaralé, než se obnoví: podepsaná adresa platí nejméně hodinu (okno podpisu),
 * takže zastaralá odpověď nikdy nenese prošlou adresu. S cookie hosta po PINu (může jít o chráněnou
 * fotografii) je odpověď `private, no-store`: do žádné sdílené mezipaměti ani do mezipaměti prohlížeče.
 */
export const MEDIA_CACHE = {
  shared: "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
  guest: "private, no-store",
  /** Náhledy správce (i nezveřejněné fotografie): jen mezipaměť prohlížeče správce, pět minut. */
  admin: "private, max-age=300",
} as const;

/**
 * Přesměrování na podepsanou adresu úložiště pro klíč varianty. `cache` volí hlavičku `Cache-Control`
 * (viz `MEDIA_CACHE`): `shared` jen pro požadavek bez relace hosta po PINu.
 */
export async function mediaRedirect(
  key: string,
  options: { cache: keyof typeof MEDIA_CACHE },
): Promise<Response> {
  const location = await getStorage().presignGet(key, {
    windowSeconds: MEDIA_LIMITS.deliveryWindowSeconds,
  });
  return new Response(null, {
    status: 302,
    headers: {
      // Cookie rozhoduje o tom, co host uvidí (chráněné fotografie), proto vždy `Vary: Cookie`.
      Location: location,
      "Cache-Control": MEDIA_CACHE[options.cache],
      Vary: "Cookie",
      "X-Robots-Tag": NOINDEX,
      "Referrer-Policy": "no-referrer",
    },
  });
}
