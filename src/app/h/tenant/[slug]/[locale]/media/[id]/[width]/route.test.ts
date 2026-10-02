import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const guest = vi.hoisted(() => ({
  session: null as null | { sessionId: string; weddingId: string },
}));
vi.mock("@/auth/guest-session", () => ({
  getGuestSession: vi.fn(async (weddingId: string) =>
    guest.session && guest.session.weddingId === weddingId ? guest.session : null,
  ),
  guestIdentity: (access: { sessionId: string; weddingId: string }) => ({
    weddingId: access.weddingId,
    weddingRole: "guest_pin" as const,
    subject: access.sessionId,
  }),
}));

import { setTransport } from "@/lib/db/rpc";
import { DbError } from "@/lib/db/transport";
import { setStorage, variantKey } from "@/lib/storage";
import { createMemoryStorage } from "@/lib/storage/memory";
import { GET } from "./route";

const WEDDING = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const MEDIA = "9d2f1a40-5b6c-4d7e-8f90-a1b2c3d4e5f6";

type Call = { fn: string; args: Record<string, unknown>; as?: { weddingRole: string } };
let calls: Call[];
let rows: { storage_key: string; bytes: number }[];
let failDb = false;

beforeEach(() => {
  calls = [];
  rows = [{ storage_key: variantKey(WEDDING, MEDIA, 640, "webp"), bytes: 1234 }];
  guest.session = null;
  failDb = false;
  setStorage(createMemoryStorage());
  setTransport({
    async call(fn, args, _kind, as) {
      calls.push({ fn, args, as });
      if (failDb) throw new DbError(fn, "XX000", "chyba spojení");
      if (fn === "resolve_slug") {
        return args.p_slug === "klara-a-matej"
          ? [
              {
                wedding_id: WEDDING,
                status: "published",
                default_locale: "cs",
                locales: ["cs"],
                template: "chateau",
              },
            ]
          : [];
      }
      if (fn === "get_public_media") return rows;
      throw new Error(`Neočekávané volání ${fn}`);
    },
  });
});
afterEach(() => {
  setTransport(null);
  setStorage(null);
});

function request(id = MEDIA, width = "640", query = "", slug = "klara-a-matej"): Promise<Response> {
  return GET(new Request(`http://klara-a-matej.localhost/media/${id}/${width}${query}`), {
    params: Promise.resolve({ slug, locale: "cs", id, width }),
  } as never);
}

describe("GET /media/{media_id}/{šířka} na webu páru", () => {
  it("přesměruje na podepsanou adresu úložiště s krátkou cache a bez indexace", async () => {
    const response = await request();
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!, "http://x");
    expect(location.pathname).toBe("/api/dev-storage");
    expect(location.searchParams.get("key")).toBe(variantKey(WEDDING, MEDIA, 640, "webp"));
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("návštěvník jde do databáze s rolí visitor, formát a šířka se předají beze změny", async () => {
    await request(MEDIA.toUpperCase(), "1280", "?f=avif");
    const call = calls.find((c) => c.fn === "get_public_media")!;
    expect(call.as?.weddingRole).toBe("visitor");
    expect(call.args).toEqual({ p_media_id: MEDIA, p_width: 1280, p_format: "avif" });
  });

  it("výchozí formát je WebP", async () => {
    await request();
    expect(calls.find((c) => c.fn === "get_public_media")!.args.p_format).toBe("webp");
  });

  it("host s platnou relací po PINu jde do databáze s rolí guest_pin (chráněné fotografie)", async () => {
    guest.session = { sessionId: SESSION_ID, weddingId: WEDDING };
    await request();
    expect(calls.find((c) => c.fn === "get_public_media")!.as?.weddingRole).toBe("guest_pin");
  });

  it("relace hosta jiné svatby nic neodemkne", async () => {
    guest.session = { sessionId: SESSION_ID, weddingId: "55555555-5555-4555-8555-555555555555" };
    await request();
    expect(calls.find((c) => c.fn === "get_public_media")!.as?.weddingRole).toBe("visitor");
  });

  it("adresa je po dobu časového okna stejná (prohlížeč ji cachuje)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2027-01-01T10:00:10Z"));
      const first = (await request()).headers.get("location");
      vi.setSystemTime(new Date("2027-01-01T10:40:00Z"));
      const second = (await request()).headers.get("location");
      vi.setSystemTime(new Date("2027-01-01T11:10:00Z"));
      const third = (await request()).headers.get("location");
      expect(second).toBe(first);
      expect(third).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("nezveřejněné, smazané, cizí i chráněné médium je prázdné 404 bez cache a bez indexace", async () => {
    rows = [];
    const response = await request();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("location")).toBeNull();
  });

  it("neznámá adresa webu je 404 a do databáze médií se nesahá", async () => {
    const response = await request(MEDIA, "640", "", "neexistuje");
    expect(response.status).toBe(404);
    expect(calls.map((c) => c.fn)).toEqual(["resolve_slug"]);
  });

  it.each([
    ["neni-uuid", "640", ""],
    [MEDIA, "abc", ""],
    [MEDIA, "640.webp", ""],
    [MEDIA, "15", ""],
    [MEDIA, "99999", ""],
    [MEDIA, "-640", ""],
    [MEDIA, "640", "?f=jpeg"],
    [MEDIA, "640", "?f=svg"],
    ["../../etc/passwd", "640", ""],
  ])("neplatný požadavek %s/%s%s je 404 bez dotazu do databáze", async (id, width, query) => {
    const response = await request(id, width, query);
    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("neplatný tvar adresy webu je 404", async () => {
    const response = await request(MEDIA, "640", "", "../x");
    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("chyba databáze je 503 bez podrobností a bez cache", async () => {
    failDb = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("nenastavené úložiště (produkce bez R2) je 503, ne pád", async () => {
    const { createUnconfiguredStorage } = await import("@/lib/storage");
    setStorage(createUnconfiguredStorage());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await request()).status).toBe(503);
  });
});
