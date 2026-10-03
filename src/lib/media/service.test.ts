import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
});

import { setTransport } from "@/lib/db/rpc";
import { DbError } from "@/lib/db/transport";
import { createUnconfiguredStorage, incomingKey, setStorage, variantKey } from "@/lib/storage";
import { createMemoryStorage, type MemoryStorage } from "@/lib/storage/memory";
import {
  deleteMedia,
  exportPhotos,
  finishUpload,
  listMedia,
  renewUpload,
  requestUpload,
  pruneCardImages,
  storeCardImage,
  updateMedia,
} from "./service";

const WEDDING = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const SESSION = { weddingId: WEDDING, subjectId: ADMIN };

type Row = {
  id: string;
  wedding_id: string;
  kind: "photo" | "card";
  status: "pending" | "processing" | "ready" | "failed";
  failure_code: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  alt: Record<string, string> | null;
  decorative: boolean;
  created_at: string;
  variants: { width: number; height: number; format: string; bytes: number; key: string }[];
};

/**
 * Doplněk databáze v paměti: stejná pravidla jako funkce `admin_media_*` (kvóta, stavy, izolace svatby), aby šlo
 * zkoušet celý tok nahrání a zpracování bez PostgreSQL. SQL samotné ověřují testy v `supabase/tests/88_media`.
 */
function fakeDb(options: { quota?: number; rateAllowed?: boolean; failComplete?: boolean } = {}) {
  const rows = new Map<string, Row>();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let counter = 0;
  const quota = options.quota ?? 12;

  const view = (row: Row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    failure_code: row.failure_code,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    alt: row.alt,
    decorative: row.decorative,
    created_at: row.created_at,
    variants: row.variants.map((v) => ({
      width: v.width,
      height: v.height,
      format: v.format,
      bytes: v.bytes,
    })),
  });
  const own = (id: unknown, as?: { weddingId: string }) => {
    const row = rows.get(String(id));
    return row && row.wedding_id === as?.weddingId ? row : undefined;
  };
  const fail = (reason: string) => new DbError("fn", "P0001", reason);

  setTransport({
    async call(fn, args, _kind, as) {
      calls.push({ fn, args });
      switch (fn) {
        case "rate_limit_hit": {
          const allowed = options.rateAllowed ?? true;
          return [{ allowed, retry_after: allowed ? 0 : 99 }];
        }
        case "admin_media_request": {
          const live = [...rows.values()].filter(
            (r) =>
              r.wedding_id === as?.weddingId &&
              r.kind === args.p_kind &&
              ["pending", "processing", "ready"].includes(r.status),
          );
          if (args.p_kind === "photo" && live.length >= quota) throw fail("media_quota");
          if (args.p_kind === "card" && live.length >= 3) throw fail("media_quota");
          if (!["image/jpeg", "image/png", "image/webp"].includes(String(args.p_mime))) {
            throw fail("invalid_payload");
          }
          const id = `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
          rows.set(id, {
            id,
            wedding_id: as!.weddingId,
            kind: args.p_kind as "photo" | "card",
            status: "pending",
            failure_code: null,
            mime: String(args.p_mime),
            width: null,
            height: null,
            bytes: Number(args.p_bytes),
            alt: null,
            decorative: args.p_kind === "card",
            created_at: new Date(2026, 9, 2, 10, 0, counter).toISOString(),
            variants: [],
          });
          return { id, stale: [] };
        }
        case "admin_media_list":
          return [...rows.values()].filter((r) => r.wedding_id === as?.weddingId).map(view);
        case "admin_media_get": {
          const row = own(args.p_media_id, as);
          return row ? view(row) : null;
        }
        case "admin_media_begin": {
          const row = own(args.p_media_id, as);
          if (!row) throw fail("media_not_found");
          if (row.status === "processing") throw fail("media_busy");
          if (row.status !== "pending") throw fail("media_not_pending");
          row.status = "processing";
          return { id: row.id, kind: row.kind, mime: row.mime, bytes: row.bytes };
        }
        case "admin_media_complete": {
          const row = own(args.p_media_id, as);
          if (!row) throw fail("media_not_found");
          if (options.failComplete) throw new DbError(fn, "XX000", "chyba SQL");
          row.status = "ready";
          row.width = Number(args.p_width);
          row.height = Number(args.p_height);
          row.variants = JSON.parse(String(args.p_variants));
          row.bytes = row.variants.reduce((sum, v) => sum + v.bytes, 0);
          return view(row);
        }
        case "admin_media_fail": {
          const row = own(args.p_media_id, as);
          if (!row) throw fail("media_not_found");
          row.status = "failed";
          row.failure_code = String(args.p_code);
          return null;
        }
        case "admin_media_update": {
          const row = own(args.p_media_id, as);
          if (!row) throw fail("media_not_found");
          row.alt = (args.p_alt as Record<string, string> | null) ?? null;
          row.decorative = Boolean(args.p_decorative);
          return view(row);
        }
        case "admin_media_delete": {
          if (!own(args.p_media_id, as)) throw fail("media_not_found");
          rows.delete(String(args.p_media_id));
          return null;
        }
        default:
          throw new Error(`Neočekávané volání ${fn}`);
      }
    },
  });
  return { rows, calls };
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = createMemoryStorage();
  setStorage(storage);
});
afterEach(() => {
  setTransport(null);
  setStorage(null);
  vi.restoreAllMocks();
});

async function jpeg(width = 3000, height = 2000, exif = true) {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 60, b: 30 } },
  }).jpeg();
  return (
    exif
      ? base.withExif({
          IFD0: { Make: "TajnaZnacka" },
          IFD3: {
            GPSLatitudeRef: "N",
            GPSLatitude: "50/1 5/1 0/1",
            GPSLongitudeRef: "E",
            GPSLongitude: "14/1 25/1 0/1",
          },
        })
      : base
  ).toBuffer();
}

/** Žádost o nahrání + nahrání originálu do karantény (to dělá prohlížeč přímo do úložiště). */
async function upload(content: Buffer, mime = "image/jpeg") {
  const requested = await requestUpload(SESSION, { mime, bytes: content.length });
  if (requested.status !== "ok") throw new Error(`žádost selhala: ${requested.status}`);
  await storage.putObject(incomingKey(WEDDING, requested.id), content, { contentType: mime });
  return requested;
}

describe("requestUpload: žádost o podepsanou adresu", () => {
  it("založí médium a vrátí krátkodobě platnou adresu pro PUT do karantény vlastní svatby", async () => {
    const { rows } = fakeDb();
    const result = await requestUpload(SESSION, { mime: "image/jpeg", bytes: 5_000_000 });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(result.expiresInSeconds).toBe(600);
    const url = new URL(result.url, "http://x");
    expect(url.searchParams.get("key")).toBe(`incoming/${WEDDING}/${result.id}`);
    expect(rows.get(result.id)).toMatchObject({
      wedding_id: WEDDING,
      status: "pending",
      kind: "photo",
    });
  });

  it.each([
    [{ mime: "image/svg+xml", bytes: 1000 }, "bad_type"],
    [{ mime: "image/gif", bytes: 1000 }, "bad_type"],
    [{ mime: "image/heic", bytes: 1000 }, "bad_type"],
    [{ mime: "text/html", bytes: 1000 }, "bad_type"],
    [{ mime: "image/jpeg", bytes: 0 }, "bad_type"],
    [{ mime: "image/jpeg", bytes: -5 }, "bad_type"],
    [{ mime: "image/jpeg" }, "bad_type"],
    [null, "bad_type"],
    [{ mime: "image/jpeg", bytes: 40 * 1024 * 1024 + 1 }, "too_large"],
  ])("odmítne %j ještě před databází: %s", async (input, status) => {
    const { calls } = fakeDb();
    expect(await requestUpload(SESSION, input)).toEqual({ status });
    expect(calls.filter((c) => c.fn === "admin_media_request")).toEqual([]);
  });

  it("kvóta 12 fotografií se hlídá v databázi", async () => {
    fakeDb({ quota: 2 });
    expect((await requestUpload(SESSION, { mime: "image/png", bytes: 1000 })).status).toBe("ok");
    expect((await requestUpload(SESSION, { mime: "image/png", bytes: 1000 })).status).toBe("ok");
    expect(await requestUpload(SESSION, { mime: "image/png", bytes: 1000 })).toEqual({
      status: "quota",
    });
  });

  it("omezení počtu požadavků podle svatby", async () => {
    const { calls } = fakeDb({ rateAllowed: false });
    expect(await requestUpload(SESSION, { mime: "image/png", bytes: 1000 })).toEqual({
      status: "limited",
      retryAfter: 99,
    });
    expect(calls.map((c) => c.fn)).toEqual(["rate_limit_hit"]);
  });

  it("produkce bez R2: srozumitelné „nedostupné“, databáze se nezakládá", async () => {
    setStorage(createUnconfiguredStorage(["R2_BUCKET"]));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { calls } = fakeDb();
    expect(await requestUpload(SESSION, { mime: "image/png", bytes: 1000 })).toEqual({
      status: "unavailable",
    });
    expect(calls).toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("R2_ACCOUNT_ID"));
  });

  it("selhání podpisu označí médium za chybné, ať nedrží kvótu", async () => {
    const { rows } = fakeDb();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(storage, "presignPut").mockRejectedValue(new Error("boom"));
    expect(await requestUpload(SESSION, { mime: "image/png", bytes: 1000 })).toEqual({
      status: "unavailable",
    });
    expect([...rows.values()].map((r) => [r.status, r.failure_code])).toEqual([
      ["failed", "storage"],
    ]);
  });

  it("obnovení adresy platí jen pro čekající fotografii vlastní svatby", async () => {
    const { rows } = fakeDb();
    const first = await requestUpload(SESSION, { mime: "image/jpeg", bytes: 1000 });
    if (first.status !== "ok") throw new Error("žádost");
    const renewed = await renewUpload(SESSION, { id: first.id, mime: "image/jpeg" });
    expect(renewed).toMatchObject({ status: "ok", id: first.id });
    expect(rows.size).toBe(1);
    // jiná svatba, neplatný vstup a cizí typ
    expect(
      await renewUpload({ ...SESSION, weddingId: OTHER }, { id: first.id, mime: "image/jpeg" }),
    ).toEqual({
      status: "not_found",
    });
    expect(await renewUpload(SESSION, { id: "x", mime: "image/jpeg" })).toEqual({
      status: "not_found",
    });
    expect(await renewUpload(SESSION, { id: first.id, mime: "image/svg+xml" })).toEqual({
      status: "not_found",
    });
    rows.get(first.id)!.status = "ready";
    expect(await renewUpload(SESSION, { id: first.id, mime: "image/jpeg" })).toEqual({
      status: "not_found",
    });
  });
});

describe("finishUpload: zpracování na serveru", () => {
  it("vytvoří šest variant, uloží je pod {wedding_id}/{media_id}/{šířka}.{formát} a smaže originál", async () => {
    const { rows, calls } = fakeDb();
    const { id } = await upload(await jpeg());
    const result = await finishUpload(SESSION, id);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.item).toMatchObject({
      id,
      status: "ready",
      kind: "photo",
      widths: [640, 1280, 1920],
    });
    expect(result.item.width).toBe(1920);
    expect(result.item.height).toBe(1280);

    expect(storage.keys()).toEqual(
      [640, 1280, 1920]
        .flatMap((w) => ["avif", "webp"].map((f) => `${WEDDING}/${id}/${w}.${f}`))
        .sort(),
    );
    // originál (s polohou) v karanténě je pryč
    expect(storage.keys().some((key) => key.startsWith("incoming/"))).toBe(false);
    // databáze dostala přesně uložené klíče
    const complete = calls.find((c) => c.fn === "admin_media_complete")!;
    const sent = JSON.parse(String(complete.args.p_variants)) as { key: string }[];
    expect(sent.map((v) => v.key).sort()).toEqual(storage.keys());
    expect(rows.get(id)?.status).toBe("ready");
  }, 60_000);

  it("uložené varianty nenesou EXIF ani polohu a mají správný typ", async () => {
    fakeDb();
    const input = await jpeg(2000, 1000);
    expect(input.includes(Buffer.from("TajnaZnacka"))).toBe(true);
    const { id } = await upload(input);
    await finishUpload(SESSION, id);
    for (const key of storage.keys()) {
      const data = await storage.getObject(key, { maxBytes: 50_000_000 });
      expect(data).not.toBeNull();
      expect(data!.includes(Buffer.from("TajnaZnacka")), key).toBe(false);
      expect(data!.includes(Buffer.from("Exif")), key).toBe(false);
      const meta = await sharp(data!).metadata();
      expect(meta.exif, key).toBeUndefined();
      expect(storage.contentType(key)).toBe(key.endsWith(".avif") ? "image/avif" : "image/webp");
    }
  }, 60_000);

  it("opakované dokončení vrátí hotovou fotografii, nezpracovává se znovu", async () => {
    const { calls } = fakeDb();
    const { id } = await upload(await jpeg(1200, 800, false));
    const first = await finishUpload(SESSION, id);
    const second = await finishUpload(SESSION, id);
    expect(first.status).toBe("ok");
    expect(second).toEqual(first);
    expect(calls.filter((c) => c.fn === "admin_media_begin")).toHaveLength(1);
  });

  it("fotografie cizí svatby se nezpracuje", async () => {
    fakeDb();
    const { id } = await upload(await jpeg(800, 600, false));
    expect(await finishUpload({ ...SESSION, weddingId: OTHER }, id)).toEqual({
      status: "not_found",
    });
    expect(await finishUpload(SESSION, "../../x")).toEqual({ status: "not_found" });
    expect(await finishUpload(SESSION, 5)).toEqual({ status: "not_found" });
  });

  it.each([
    [
      "SVG převlečené za JPEG",
      () => Promise.resolve(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
      "unsupported_type",
    ],
    [
      "HTML",
      () => Promise.resolve(Buffer.from("<html><script>alert(1)</script></html>")),
      "unsupported_type",
    ],
    [
      "GIF",
      () => Promise.resolve(Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;")),
      "unsupported_type",
    ],
    [
      "HEIC",
      () =>
        Promise.resolve(
          Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(32)]),
        ),
      "heic",
    ],
    ["poškozený JPEG", async () => (await jpeg(2000, 1500, false)).subarray(0, 4000), "corrupt"],
  ])(
    "%s: odmítnuto podle obsahu, originál smazán hned, médium chybné s kódem",
    async (_name, make, code) => {
      const { rows } = fakeDb();
      const { id } = await upload(await make());
      expect(await finishUpload(SESSION, id)).toEqual({ status: "failed", code });
      expect(storage.keys()).toEqual([]);
      expect(rows.get(id)).toMatchObject({ status: "failed", failure_code: code });
    },
  );

  it("příliš mnoho pixelů se odmítne a nic se neuloží", async () => {
    const { rows } = fakeDb();
    const real = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    const bomb = Buffer.from(real);
    bomb.writeUInt32BE(20000, 16);
    bomb.writeUInt32BE(20000, 20);
    const { crc32 } = await import("node:zlib");
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)) >>> 0, 29);
    const { id } = await upload(bomb, "image/png");
    expect(await finishUpload(SESSION, id)).toEqual({ status: "failed", code: "too_many_pixels" });
    expect(storage.keys()).toEqual([]);
    expect(rows.get(id)?.failure_code).toBe("too_many_pixels");
  });

  it("soubor v úložišti nad limitem (i když prohlížeč tvrdil menší) se odmítne a smaže", async () => {
    const { rows } = fakeDb();
    const requested = await requestUpload(SESSION, { mime: "image/jpeg", bytes: 1000 });
    if (requested.status !== "ok") throw new Error("žádost");
    storage.put(incomingKey(WEDDING, requested.id), 40 * 1024 * 1024 + 1);
    expect(await finishUpload(SESSION, requested.id)).toEqual({
      status: "failed",
      code: "too_large",
    });
    expect(storage.keys()).toEqual([]);
    expect(rows.get(requested.id)?.failure_code).toBe("too_large");
  });

  it("nenahraný soubor je chybějící soubor", async () => {
    const { rows } = fakeDb();
    const requested = await requestUpload(SESSION, { mime: "image/jpeg", bytes: 1000 });
    if (requested.status !== "ok") throw new Error("žádost");
    expect(await finishUpload(SESSION, requested.id)).toEqual({
      status: "failed",
      code: "missing_file",
    });
    expect(rows.get(requested.id)?.status).toBe("failed");
  });

  it("selhání zápisu variant uklidí všechno a označí médium za chybné", async () => {
    const { rows } = fakeDb();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { id } = await upload(await jpeg(1500, 1000, false));
    const put = storage.putObject.bind(storage);
    let writes = 0;
    vi.spyOn(storage, "putObject").mockImplementation(async (key, body, options) => {
      if (key.startsWith("incoming/")) return put(key, body, options);
      if (++writes === 3) throw new Error("R2 nedostupné");
      return put(key, body, options);
    });
    expect(await finishUpload(SESSION, id)).toEqual({ status: "failed", code: "storage" });
    expect(storage.keys()).toEqual([]);
    expect(rows.get(id)?.failure_code).toBe("storage");
  }, 60_000);

  it("selhání zápisu do databáze po uložení variant uklidí soubory", async () => {
    fakeDb({ failComplete: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { id } = await upload(await jpeg(1500, 1000, false));
    expect(await finishUpload(SESSION, id)).toEqual({ status: "failed", code: "internal" });
    expect(storage.keys()).toEqual([]);
  }, 60_000);

  it("omezení počtu požadavků a nenastavené úložiště", async () => {
    fakeDb({ rateAllowed: false });
    expect(await finishUpload(SESSION, "00000000-0000-4000-8000-000000000001")).toEqual({
      status: "limited",
      retryAfter: 99,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setStorage(createUnconfiguredStorage());
    expect(await finishUpload(SESSION, "00000000-0000-4000-8000-000000000001")).toEqual({
      status: "unavailable",
    });
  });

  it("souběžné zpracování téhož média vrací „busy“", async () => {
    const { rows } = fakeDb();
    const { id } = await upload(await jpeg(800, 600, false));
    rows.get(id)!.status = "processing";
    expect(await finishUpload(SESSION, id)).toEqual({ status: "busy" });
  });
});

describe("storeCardImage: obrázek karty externí galerie", () => {
  it("projde stejným zpracováním jako fotografie (typ podle obsahu, překódování, bez metadat)", async () => {
    const { rows } = fakeDb();
    const data = await jpeg(2400, 1200);
    const id = await storeCardImage(SESSION, { data, contentType: "image/jpeg" });
    expect(id).not.toBeNull();
    expect(rows.get(id!)).toMatchObject({ kind: "card", status: "ready", decorative: true });
    // karta má varianty 640 a 1280 (ne 1920) a žádná neobsahuje metadata
    expect(
      storage
        .keys()
        .map((key) => key.split("/").pop())
        .sort(),
    ).toEqual(["1280.avif", "1280.webp", "640.avif", "640.webp"]);
    for (const key of storage.keys()) {
      const stored = await storage.getObject(key, { maxBytes: 50_000_000 });
      expect(stored!.includes(Buffer.from("TajnaZnacka"))).toBe(false);
    }
  }, 60_000);

  it("SVG a cokoli jiného než obrázek se nezpracuje, nic nezůstane v úložišti", async () => {
    const { rows } = fakeDb();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(await storeCardImage(SESSION, { data: svg, contentType: "image/svg+xml" })).toBeNull();
    // převlečené za JPEG: rozhodne obsah
    expect(await storeCardImage(SESSION, { data: svg, contentType: "image/jpeg" })).toBeNull();
    expect(storage.keys()).toEqual([]);
    expect([...rows.values()].every((r) => r.status === "failed")).toBe(true);
  });

  it("obrázek nad limit karty (5 MB) se nezpracuje", async () => {
    fakeDb();
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024 + 1)]);
    expect(await storeCardImage(SESSION, { data: big, contentType: "image/jpeg" })).toBeNull();
    expect(storage.keys()).toEqual([]);
  });

  it("bez nastaveného úložiště se nic nezkouší (dnešní chování: karta bez obrázku)", async () => {
    const { calls } = fakeDb();
    setStorage(createUnconfiguredStorage());
    expect(
      await storeCardImage(SESSION, {
        data: await jpeg(800, 600, false),
        contentType: "image/jpeg",
      }),
    ).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("pruneCardImages: úklid starých obrázků karet", () => {
  it("smaže nejstarší nad limit, ale nikdy obrázek, který používá zveřejněný web nebo pracovní kopie", async () => {
    const { rows } = fakeDb();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = await storeCardImage(SESSION, {
        data: await jpeg(800, 600, false),
        contentType: "image/jpeg",
      });
      ids.push(id!);
    }
    // nejstarší (ids[0]) používá zveřejněný web: zůstane i s posledním, smaže se jen ids[1]
    await pruneCardImages(SESSION, 1, new Set([ids[0]]));
    expect([...rows.keys()].sort()).toEqual([ids[0], ids[2]].sort());
  }, 60_000);
});

describe("popisek, smazání, seznam a export", () => {
  async function ready(content?: Buffer) {
    const { id } = await upload(content ?? (await jpeg(1300, 900, false)));
    const result = await finishUpload(SESSION, id);
    if (result.status !== "ok") throw new Error("zpracování");
    return id;
  }

  it("popisek se ořízne, prázdné jazyky zmizí, neplatný vstup se odmítne před databází", async () => {
    const { rows, calls } = fakeDb();
    const id = await ready();
    const result = await updateMedia(SESSION, {
      id,
      alt: { cs: "  Na zámku  ", en: "   " },
      decorative: false,
    });
    expect(result.status).toBe("ok");
    expect(rows.get(id)?.alt).toEqual({ cs: "Na zámku" });
    const before = calls.length;
    for (const bad of [
      { id, alt: { de: "x" }, decorative: false },
      { id, alt: { cs: "x".repeat(301) }, decorative: false },
      { id, alt: { cs: 5 }, decorative: false },
      { id: "x", alt: null, decorative: false },
      { id, alt: null },
      null,
    ]) {
      expect(await updateMedia(SESSION, bad)).toEqual({ status: "invalid" });
    }
    expect(calls.length).toBe(before);
  }, 60_000);

  it("popisek cizí fotografie se nezmění", async () => {
    fakeDb();
    const id = await ready();
    expect(
      await updateMedia(
        { ...SESSION, weddingId: OTHER },
        { id, alt: { cs: "Cizí" }, decorative: false },
      ),
    ).toEqual({ status: "not_found" });
  }, 60_000);

  it("mazání: nejdřív soubory (originál i varianty), teprve potom řádek", async () => {
    const { rows } = fakeDb();
    const id = await ready();
    const order: string[] = [];
    const original = storage.deleteMedia.bind(storage);
    vi.spyOn(storage, "deleteMedia").mockImplementation(async (weddingId, mediaId) => {
      order.push(`soubory:${rows.has(id) ? "řádek existuje" : "řádek pryč"}`);
      return original(weddingId, mediaId);
    });
    expect(await deleteMedia(SESSION, id)).toEqual({ status: "ok" });
    expect(order).toEqual(["soubory:řádek existuje"]);
    expect(rows.has(id)).toBe(false);
  }, 60_000);

  it("skutečné mazání odstraní všechny soubory média a cizí nechá", async () => {
    const { rows } = fakeDb();
    const id = await ready();
    storage.put(variantKey(OTHER, id, 640, "webp"));
    expect(storage.keys().length).toBe(5);
    expect(await deleteMedia(SESSION, id)).toEqual({ status: "ok" });
    expect(storage.keys()).toEqual([variantKey(OTHER, id, 640, "webp")]);
    expect(rows.size).toBe(0);
  }, 60_000);

  it("selhání mazání souborů řádek nesmaže (jde zopakovat)", async () => {
    const { rows } = fakeDb();
    const id = await ready();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    storage.failDeleteFor.add(WEDDING);
    expect(await deleteMedia(SESSION, id)).toEqual({ status: "unavailable" });
    expect(rows.has(id)).toBe(true);
    expect(storage.keys().length).toBeGreaterThan(0);
    storage.failDeleteFor.clear();
    expect(await deleteMedia(SESSION, id)).toEqual({ status: "ok" });
    expect(storage.keys()).toEqual([]);
  }, 60_000);

  it("cizí a neexistující médium se nesmaže", async () => {
    const { rows } = fakeDb();
    const id = await ready();
    expect(await deleteMedia({ ...SESSION, weddingId: OTHER }, id)).toEqual({
      status: "not_found",
    });
    expect(await deleteMedia(SESSION, "neni-uuid")).toEqual({ status: "not_found" });
    expect(rows.has(id)).toBe(true);
    expect(storage.keys().length).toBe(4);
  }, 60_000);

  it("seznam nese jen vlastní média a žádné klíče úložiště", async () => {
    fakeDb();
    const id = await ready();
    const items = await listMedia(SESSION);
    expect(items.map((i) => i.id)).toEqual([id]);
    expect(JSON.stringify(items)).not.toContain(WEDDING);
    expect(JSON.stringify(items)).not.toContain("incoming");
    expect(await listMedia({ ...SESSION, weddingId: OTHER })).toEqual([]);
  }, 60_000);

  it("export: největší varianta každé fotografie, názvy podle pořadí, karty ne", async () => {
    fakeDb();
    const first = await ready();
    const second = await ready(await jpeg(2600, 1700, false));
    await storeCardImage(SESSION, {
      data: await jpeg(1400, 700, false),
      contentType: "image/jpeg",
    });
    const result = await exportPhotos(SESSION);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.files.map((f) => [f.name, f.width])).toEqual([
      ["foto-01.webp", 1280],
      ["foto-02.webp", 1920],
    ]);
    const urls = result.files.map((f) => new URL(f.url, "http://x").searchParams.get("key"));
    expect(urls).toEqual([
      variantKey(WEDDING, first, 1280, "webp"),
      variantKey(WEDDING, second, 1920, "webp"),
    ]);
  }, 60_000);

  it("export bez fotografií, bez úložiště a při překročení limitu", async () => {
    fakeDb();
    expect(await exportPhotos(SESSION)).toEqual({ status: "empty" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setStorage(createUnconfiguredStorage());
    expect(await exportPhotos(SESSION)).toEqual({ status: "unavailable" });
    fakeDb({ rateAllowed: false });
    expect(await exportPhotos(SESSION)).toEqual({ status: "limited", retryAfter: 99 });
  });
});
