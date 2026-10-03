import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  limit: { allowed: true, retryAfter: 0 },
  tile: new Uint8Array([137, 80, 78, 71]) as Uint8Array | null,
}));
vi.mock("@/auth/request", () => ({ getClientIp: async () => "203.0.113.5" }));
vi.mock("@/env", () => ({ requireEnv: () => "s".repeat(32) }));
vi.mock("@/lib/db/rpc", () => ({ rateLimitHit: vi.fn(async () => state.limit) }));
vi.mock("@/site/map/server", () => ({ fetchTile: vi.fn(async () => state.tile) }));

import { fetchTile } from "@/site/map/server";
import { GET } from "./route";

function get(z: string, x: string, y: string, search = "") {
  return GET(new Request(`http://localhost/api/map-tile/${z}/${x}/${y}${search}`), {
    params: Promise.resolve({ z, x, y }),
  });
}

beforeEach(() => {
  state.limit = { allowed: true, retryAfter: 0 };
  state.tile = new Uint8Array([137, 80, 78, 71]);
});

describe("/api/map-tile", () => {
  it("vrátí dlaždici s dlouhou sdílenou mezipamětí", async () => {
    const response = await get("15", "17700", "11100");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("s-maxage=604800");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(fetchTile).toHaveBeenCalledWith(15, 17700, 11100);
  });

  it.each([
    ["17", "0", "0"],
    ["2", "4", "0"],
    ["2", "0", "4"],
    ["-1", "0", "0"],
    ["abc", "0", "0"],
    ["+1", "0", "0"],
    ["1.5", "0", "0"],
    ["15", "017700", "11100"],
    ["015", "1", "1"],
  ])("neplatná dlaždice %s/%s/%s je 404 bez stahování", async (z, x, y) => {
    const response = await get(z, x, y);
    expect(response.status).toBe(404);
    expect(fetchTile).not.toHaveBeenCalled();
  });

  it("adresa s parametry je 404 (jinak by každý dotaz obešel mezipaměť CDN)", async () => {
    expect((await get("10", "1", "1", "?r=1")).status).toBe(404);
    expect(fetchTile).not.toHaveBeenCalled();
  });

  it("po překročení limitu 429 s Retry-After", async () => {
    state.limit = { allowed: false, retryAfter: 42 };
    const response = await get("10", "1", "1");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("nedostupný zdroj je 502 a neukládá se", async () => {
    state.tile = null;
    const response = await get("10", "1", "1");
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
