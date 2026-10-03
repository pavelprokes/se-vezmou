import "server-only";
import { z } from "zod";
import { RATE_RULES } from "@/auth/config";
import { rateKey } from "@/auth/rate-limit";
import { env as appEnv, requireEnv } from "@/env";
import { rateLimitHit } from "@/lib/db/rpc";
import { testHatchesAllowed, type EnvSource } from "@/lib/test-hatches";

/**
 * Serverová strana mapy: hledání adresy (Nominatim) a dlaždice (tile.openstreetmap.org). Obojí volá
 * jen server, s vlastním User-Agentem a bez čehokoli z prohlížeče (IP, Referer), podle pravidel
 * OSMF (operations.osmfoundation.org/policies). Prohlížeč hosta dostane dlaždice z `/api/map-tile`.
 */

export const MAP_USER_AGENT = "se-vezmou.cz-maps/1.0 (+https://se-vezmou.cz)";
const TIMEOUT_MS = 5000;
const MAX_TILE_BYTES = 256 * 1024;
const LABEL_MAX = 300;

/** Jen e2e (`MAP_STUB=1`, src/lib/test-hatches.ts): bez sítě, pevné souřadnice a šedá dlaždice. */
export function mapStub(env: EnvSource = appEnv): boolean {
  return env.MAP_STUB === "1" && testHatchesAllowed(env);
}

/** Pevný bod testů (Dobřichovice) a adresa, kterou testy „nenajdou“. */
export const STUB_POINT = { lat: 49.92556, lng: 14.27639 } as const;
const STUB_NOT_FOUND = "nenalezeno";
const STUB_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAAA1BMVEXk4tzqvEo3AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAVklEQVR4nO3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQPcGAQ8AAb1ytegAAAAASUVORK5CYII=",
  "base64",
);

export type GeocodeResult =
  | { status: "found"; lat: number; lng: number; label: string }
  | { status: "not_found" }
  | { status: "limited"; retryAfter: number };

type RateHit = (
  key: string,
  limit: number,
  windowSeconds: number,
) => ReturnType<typeof rateLimitHit>;

export interface MapDeps {
  fetch: typeof fetch;
  stub: boolean;
  rateLimitHit: RateHit;
  sleep: (ms: number) => Promise<void>;
  secret: () => string;
}

function defaultDeps(): MapDeps {
  return {
    fetch: globalThis.fetch,
    stub: mapStub(),
    rateLimitHit,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    secret: () => requireEnv("RATE_LIMIT_SECRET"),
  };
}

const nominatimSchema = z.array(
  z.object({ lat: z.string(), lon: z.string(), display_name: z.string() }),
);

/**
 * Souřadnice k textové adrese. Omezení podle IP (průvodce je anonymní) a společné pro celou aplikaci
 * (Nominatim dovoluje nejvýš 1 dotaz za sekundu). Výsledek si drží koncept nebo místo v databázi,
 * stejná adresa se znovu nehledá. Síťová chyba nebo nečekaná odpověď vyhodí výjimku.
 */
export async function geocodeAddress(
  query: string,
  ip: string,
  deps: MapDeps = defaultDeps(),
): Promise<GeocodeResult> {
  const ipRule = RATE_RULES.geocodeIp;
  const byIp = await deps.rateLimitHit(
    rateKey(deps.secret(), "geocode-ip", ip),
    ipRule.limit,
    ipRule.windowSeconds,
  );
  if (!byIp.allowed) return { status: "limited", retryAfter: byIp.retryAfter };

  if (deps.stub) {
    if (query.toLowerCase().includes(STUB_NOT_FOUND)) return { status: "not_found" };
    return { status: "found", ...STUB_POINT, label: `Testovací mapa: ${query}` };
  }

  // Jedna sekunda mezi dotazy pro celou aplikaci; při souběhu jeden pokus znovu po krátkém čekání.
  const globalRule = RATE_RULES.nominatimGlobal;
  const globalKey = rateKey(deps.secret(), "nominatim", "global");
  let slot = await deps.rateLimitHit(globalKey, globalRule.limit, globalRule.windowSeconds);
  if (!slot.allowed && slot.retryAfter <= 2) {
    await deps.sleep(slot.retryAfter * 1000);
    slot = await deps.rateLimitHit(globalKey, globalRule.limit, globalRule.windowSeconds);
  }
  if (!slot.allowed) return { status: "limited", retryAfter: slot.retryAfter };

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const response = await deps.fetch(url, {
    headers: { "User-Agent": MAP_USER_AGENT, "Accept-Language": "cs,en" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Nominatim odpověděl ${response.status}`);
  const hits = nominatimSchema.parse(await response.json());
  const hit = hits[0];
  if (!hit) return { status: "not_found" };
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error("Nominatim vrátil neplatné souřadnice");
  }
  return { status: "found", lat, lng, label: hit.display_name.slice(0, LABEL_MAX) };
}

/** Dlaždice OSM jako PNG; cokoli jiného (chyba, jiný typ, příliš velká) je `null`. */
export async function fetchTile(
  zoom: number,
  x: number,
  y: number,
  deps: Pick<MapDeps, "fetch" | "stub"> = defaultDeps(),
): Promise<Uint8Array | null> {
  if (deps.stub) return STUB_TILE;
  const response = await deps.fetch(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`, {
    headers: { "User-Agent": MAP_USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png")) return null;
  const body = new Uint8Array(await response.arrayBuffer());
  return body.byteLength > 0 && body.byteLength <= MAX_TILE_BYTES ? body : null;
}
