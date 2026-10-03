import { describe, expect, it, vi } from "vitest";
import { fetchTile, geocodeAddress, MAP_USER_AGENT, mapStub, type MapDeps } from "./server";

const SECRET = "s".repeat(32);

function deps(overrides: Partial<MapDeps> = {}): MapDeps & { fetch: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn(async () =>
      Response.json([
        { lat: "49.92556", lon: "14.27639", display_name: "Zámecká 1, Dobřichovice" },
      ]),
    ),
    stub: false,
    rateLimitHit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
    sleep: vi.fn(async () => {}),
    secret: () => SECRET,
    ...overrides,
  } as MapDeps & { fetch: ReturnType<typeof vi.fn> };
}

describe("geocodeAddress", () => {
  it("najde místo a do Nominatimu pošle jen zakódovanou adresu a vlastní User-Agent", async () => {
    const d = deps();
    const result = await geocodeAddress("Zámecká 1, Dobřichovice", "203.0.113.5", d);
    expect(result).toEqual({
      status: "found",
      lat: 49.92556,
      lng: 14.27639,
      label: "Zámecká 1, Dobřichovice",
    });
    const [url, init] = d.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=Z%C3%A1meck%C3%A1%201%2C%20Dob%C5%99ichovice",
    );
    expect(init.headers).toEqual({ "User-Agent": MAP_USER_AGENT, "Accept-Language": "cs,en" });
  });

  it("prázdný výsledek je nenalezeno", async () => {
    const d = deps({ fetch: vi.fn(async () => Response.json([])) });
    expect(await geocodeAddress("Neexistující 1", "ip", d)).toEqual({ status: "not_found" });
  });

  it("chybová nebo nečekaná odpověď a souřadnice mimo rozsah vyhodí chybu", async () => {
    await expect(
      geocodeAddress(
        "x y z",
        "ip",
        deps({ fetch: vi.fn(async () => new Response("", { status: 500 })) }),
      ),
    ).rejects.toThrow();
    await expect(
      geocodeAddress("x y z", "ip", deps({ fetch: vi.fn(async () => Response.json({ nic: 1 })) })),
    ).rejects.toThrow();
    await expect(
      geocodeAddress(
        "x y z",
        "ip",
        deps({
          fetch: vi.fn(async () => Response.json([{ lat: "91", lon: "0", display_name: "?" }])),
        }),
      ),
    ).rejects.toThrow();
  });

  it("popisek se zkrátí", async () => {
    const long = "a".repeat(500);
    const d = deps({
      fetch: vi.fn(async () => Response.json([{ lat: "1", lon: "2", display_name: long }])),
    });
    const result = await geocodeAddress("x y z", "ip", d);
    expect(result.status === "found" && result.label.length).toBe(300);
  });

  it("limit podle IP: Nominatim se nevolá", async () => {
    const d = deps({ rateLimitHit: vi.fn(async () => ({ allowed: false, retryAfter: 120 })) });
    expect(await geocodeAddress("x y z", "ip", d)).toEqual({ status: "limited", retryAfter: 120 });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("společný limit 1 dotaz za sekundu: jednou počká a zkusí znovu", async () => {
    const hits = [
      { allowed: true, retryAfter: 0 },
      { allowed: false, retryAfter: 1 },
      { allowed: true, retryAfter: 0 },
    ];
    const d = deps({ rateLimitHit: vi.fn(async () => hits.shift()!) });
    expect((await geocodeAddress("x y z", "ip", d)).status).toBe("found");
    expect(d.sleep).toHaveBeenCalledWith(1000);
  });

  it("společný limit stále plný: vytížené, bez dotazu", async () => {
    const hits = [
      { allowed: true, retryAfter: 0 },
      { allowed: false, retryAfter: 1 },
      { allowed: false, retryAfter: 1 },
    ];
    const d = deps({ rateLimitHit: vi.fn(async () => hits.shift()!) });
    expect((await geocodeAddress("x y z", "ip", d)).status).toBe("limited");
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("zástupná varianta testů nesahá na síť", async () => {
    const d = deps({ stub: true });
    expect((await geocodeAddress("Zámecká 1", "ip", d)).status).toBe("found");
    expect(await geocodeAddress("Ulice nenalezeno 5", "ip", d)).toEqual({ status: "not_found" });
    expect(d.fetch).not.toHaveBeenCalled();
  });
});

describe("fetchTile", () => {
  const png = (body: BodyInit, type = "image/png") =>
    vi.fn(async () => new Response(body, { headers: { "content-type": type } }));

  it("stáhne PNG dlaždici z OSM s vlastním User-Agentem", async () => {
    const fetch = png(new Uint8Array([1, 2, 3]));
    expect(await fetchTile(15, 1, 2, { fetch, stub: false })).toEqual(new Uint8Array([1, 2, 3]));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://tile.openstreetmap.org/15/1/2.png");
    expect(init.headers).toEqual({ "User-Agent": MAP_USER_AGENT });
  });

  it("jiný typ, chyba nebo příliš velká odpověď je null", async () => {
    expect(await fetchTile(1, 0, 0, { fetch: png("<html>", "text/html"), stub: false })).toBeNull();
    expect(
      await fetchTile(1, 0, 0, {
        fetch: vi.fn(async () => new Response(null, { status: 404 })),
        stub: false,
      }),
    ).toBeNull();
    expect(
      await fetchTile(1, 0, 0, { fetch: png(new Uint8Array(300 * 1024)), stub: false }),
    ).toBeNull();
  });
});

describe("mapStub", () => {
  it("jen s MAP_STUB=1 a tam, kde smějí fungovat testovací vrátka", () => {
    expect(mapStub({ MAP_STUB: "1", NODE_ENV: "test" })).toBe(true);
    expect(mapStub({ NODE_ENV: "test" })).toBe(false);
    expect(mapStub({ MAP_STUB: "1", NODE_ENV: "production" })).toBe(false);
    expect(mapStub({ MAP_STUB: "1", NODE_ENV: "production", ALLOW_TEST_HATCHES: "1" })).toBe(true);
  });
});
