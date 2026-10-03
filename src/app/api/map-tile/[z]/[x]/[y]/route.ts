import { RATE_RULES } from "@/auth/config";
import { rateKey } from "@/auth/rate-limit";
import { getClientIp } from "@/auth/request";
import { requireEnv } from "@/env";
import { rateLimitHit } from "@/lib/db/rpc";
import { fetchTile } from "@/site/map/server";
import { MAX_ZOOM } from "@/site/map/view";

/**
 * Dlaždice mapy místa konání: `/api/map-tile/{z}/{x}/{y}`. Server ji stáhne z tile.openstreetmap.org
 * a vrátí s dlouhou sdílenou mezipamětí (CDN, pravidla OSMF žádají aspoň 7 dní). Prohlížeč hosta tak
 * nekontaktuje nikoho jiného a CSP zůstává `img-src 'self'`. Proxy cestu vynechává (`src/proxy.ts`),
 * takže funguje na webu páru, v náhledu průvodce i na úvodní stránce.
 *
 * ponytail: veřejná proxy dlaždic, IP limit počítá jen dotazy mimo CDN. Stahování rozložené přes mnoho
 * IP nezastaví; kdyby k tomu došlo, podepsané adresy (náhled průvodce v prohlížeči ale podepisovat neumí)
 * nebo vlastní server dlaždic.
 */

const HEADERS = { "X-Robots-Tag": "noindex, nofollow" };

function parseTile(z: string, x: string, y: string): { z: number; x: number; y: number } | null {
  if (![z, x, y].every((part) => /^\d{1,6}$/.test(part))) return null;
  const tile = { z: Number(z), x: Number(x), y: Number(y) };
  const n = 2 ** tile.z;
  return tile.z <= MAX_ZOOM && tile.x < n && tile.y < n ? tile : null;
}

export async function GET(_request: Request, context: RouteContext<"/api/map-tile/[z]/[x]/[y]">) {
  const { z, x, y } = await context.params;
  const tile = parseTile(z, x, y);
  if (!tile) {
    return new Response(null, {
      status: 404,
      headers: { ...HEADERS, "Cache-Control": "public, max-age=86400" },
    });
  }

  try {
    const rule = RATE_RULES.mapTileIp;
    const limit = await rateLimitHit(
      rateKey(requireEnv("RATE_LIMIT_SECRET"), "map-tile-ip", await getClientIp()),
      rule.limit,
      rule.windowSeconds,
    );
    if (!limit.allowed) {
      return new Response(null, {
        status: 429,
        headers: {
          ...HEADERS,
          "Cache-Control": "private, no-store",
          "Retry-After": String(limit.retryAfter),
        },
      });
    }
    const body = await fetchTile(tile.z, tile.x, tile.y);
    if (!body) throw new Error("dlaždice nedorazila");
    return new Response(body as BodyInit, {
      headers: {
        ...HEADERS,
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    // Jen druh chyby; dlaždice se nezobrazí, adresa a odkazy na mapy zůstávají.
    console.error("[mapa] dlaždice selhala", error instanceof Error ? error.name : "");
    return new Response(null, {
      status: 502,
      headers: { ...HEADERS, "Cache-Control": "private, no-store" },
    });
  }
}
