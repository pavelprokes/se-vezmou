import { describe, expect, it } from "vitest";
import {
  createUnconfiguredStorage,
  getStorage,
  noopStorage,
  resolveStorage,
  setStorage,
  storageKind,
} from "./index";
import { createMemoryStorage } from "./memory";
import {
  incomingKey,
  mediaPrefix,
  parseKey,
  variantKey,
  weddingPrefix,
  StorageTooLargeError,
} from "./types";

const A = "0b6a1c1e-3b5e-4d0c-9a1f-0d3c7e9a1b11";
const B = "7c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5";
const M = "9d2f1a40-5b6c-4d7e-8f90-a1b2c3d4e5f6";

describe("předpona úložiště", () => {
  it("je {wedding_id}/ malými písmeny", () => {
    expect(weddingPrefix(A.toUpperCase())).toBe(`${A}/`);
  });

  it.each(["", "..", "../x", `${A}/../${B}`, "klara-a-matej", `${A}/`, "*"])(
    "odmítne neplatný identifikátor %j (nikdy se nemaže volná předpona)",
    (value) => {
      expect(() => weddingPrefix(value)).toThrow();
    },
  );
});

describe("klíče objektů", () => {
  it("originál leží v karanténě, varianta pod {wedding_id}/{media_id}/", () => {
    expect(incomingKey(A, M)).toBe(`incoming/${A}/${M}`);
    expect(variantKey(A, M, 1280, "avif")).toBe(`${A}/${M}/1280.avif`);
    expect(mediaPrefix(A, M)).toBe(`${A}/${M}/`);
  });

  it("rozpozná jen dva tvary klíčů, které aplikace zapisuje", () => {
    expect(parseKey(incomingKey(A, M))).toEqual({ weddingId: A, mediaId: M, incoming: true });
    expect(parseKey(variantKey(A, M, 640, "webp"))).toEqual({
      weddingId: A,
      mediaId: M,
      incoming: false,
    });
  });

  it.each([
    "",
    `${A}/${M}/../${B}/${M}/640.webp`,
    `${A}/${M}/640.jpg`,
    `${A}/${M}/640.svg`,
    `${A}/foto/1.webp`,
    `${A}/${M}/640.webp/`,
    `incoming/${A}/${M}/x`,
    `incoming/${A}`,
    `/${A}/${M}/640.webp`,
    `${A}/${M}/%2e%2e.webp`,
    "x".repeat(300),
  ])("odmítne klíč %j", (key) => {
    expect(parseKey(key)).toBeNull();
  });

  it("varianta s nesmyslnou šířkou nebo formátem je chyba programu", () => {
    expect(() => variantKey(A, M, 0, "webp")).toThrow();
    expect(() => variantKey(A, M, 640.5, "webp")).toThrow();
    // @ts-expect-error neplatný formát
    expect(() => variantKey(A, M, 640, "jpeg")).toThrow();
    expect(() => variantKey(A, "../x", 640, "webp")).toThrow();
  });
});

describe("úložiště v paměti", () => {
  it("výpis a mazání se týkají jen předpony jedné svatby", async () => {
    const storage = createMemoryStorage();
    storage.put(`${A}/foto/1.webp`, 10);
    storage.put(`${A}/foto/2.webp`, 20);
    storage.put(`${B}/foto/1.webp`, 30);
    expect(await storage.listPrefix(A)).toEqual([
      { key: `${A}/foto/1.webp`, bytes: 10 },
      { key: `${A}/foto/2.webp`, bytes: 20 },
    ]);
    expect(await storage.deletePrefix(A)).toEqual({ deleted: 2 });
    expect(storage.keys()).toEqual([`${B}/foto/1.webp`]);
    expect(await storage.deletePrefix(A)).toEqual({ deleted: 0 });
  });

  it("smazání svatby smaže i karanténu, cizí karanténu ne", async () => {
    const storage = createMemoryStorage();
    storage.put(variantKey(A, M, 640, "webp"));
    storage.put(incomingKey(A, M));
    storage.put(incomingKey(B, M));
    expect(await storage.listPrefix(A)).toHaveLength(1);
    expect(await storage.deletePrefix(A)).toEqual({ deleted: 2 });
    expect(storage.keys()).toEqual([incomingKey(B, M)]);
  });

  it("selhání mazání vyhodí chybu a nic nesmaže", async () => {
    const storage = createMemoryStorage();
    storage.put(`${A}/foto/1.webp`);
    storage.failDeleteFor.add(A);
    await expect(storage.deletePrefix(A)).rejects.toThrow();
    expect(storage.keys()).toHaveLength(1);
    storage.failDeleteFor.clear();
    expect(await storage.deletePrefix(A)).toEqual({ deleted: 1 });
  });

  it("zapíše, přečte s limitem a smaže objekty a médium", async () => {
    const storage = createMemoryStorage();
    await storage.putObject(variantKey(A, M, 640, "webp"), Buffer.from("abc"), {
      contentType: "image/webp",
    });
    await storage.putObject(incomingKey(A, M), Buffer.from("original"), {
      contentType: "image/jpeg",
    });
    expect(await storage.headObject(variantKey(A, M, 640, "webp"))).toEqual({ bytes: 3 });
    expect(await storage.headObject(variantKey(A, M, 1280, "webp"))).toBeNull();
    expect((await storage.getObject(incomingKey(A, M), { maxBytes: 100 }))?.toString()).toBe(
      "original",
    );
    await expect(storage.getObject(incomingKey(A, M), { maxBytes: 3 })).rejects.toBeInstanceOf(
      StorageTooLargeError,
    );
    expect(await storage.getObject(incomingKey(A, B), { maxBytes: 3 })).toBeNull();
    await storage.deleteMedia(A, M);
    expect(storage.keys()).toEqual([]);
  });

  it("odmítne volný klíč (nikdy se nesahá mimo dva známé tvary)", async () => {
    const storage = createMemoryStorage();
    await expect(storage.headObject(`${A}/../${B}/x`)).rejects.toThrow();
    await expect(storage.deleteObjects([`${A}/foto/1.webp`])).rejects.toThrow();
    await expect(
      storage.putObject("x", Buffer.alloc(1), { contentType: "image/webp" }),
    ).rejects.toThrow();
  });

  it("nahrávací adresa míří jen do karantény a podpis se ověřuje", async () => {
    const storage = createMemoryStorage();
    await expect(
      storage.presignPut(variantKey(A, M, 640, "webp"), {
        contentType: "image/jpeg",
        bytes: 10,
        expiresInSeconds: 60,
      }),
    ).rejects.toThrow();
    const target = await storage.presignPut(incomingKey(A, M), {
      contentType: "image/jpeg",
      bytes: 1234,
      expiresInSeconds: 600,
    });
    expect(target.method).toBe("PUT");
    expect(target.headers["Content-Type"]).toBe("image/jpeg");
    const url = new URL(target.url, "http://x");
    const input = {
      method: "PUT" as const,
      key: url.searchParams.get("key")!,
      expires: Number(url.searchParams.get("expires")),
      signature: url.searchParams.get("sig")!,
    };
    expect(input.key).toBe(incomingKey(A, M));
    expect(storage.verify(input)).toBe(true);
    // jiná metoda, jiný klíč, prošlá platnost, poškozený podpis
    expect(storage.verify({ ...input, method: "GET" })).toBe(false);
    expect(storage.verify({ ...input, key: incomingKey(B, M) })).toBe(false);
    expect(storage.verify({ ...input, now: new Date((input.expires + 1) * 1000) })).toBe(false);
    expect(storage.verify({ ...input, signature: "zz" })).toBe(false);
    expect(storage.verify({ ...input, signature: "00".repeat(32) })).toBe(false);
  });

  it("adresa pro čtení je v rámci časového okna stejná", async () => {
    const storage = createMemoryStorage();
    const key = variantKey(A, M, 640, "webp");
    const t0 = new Date("2027-01-01T10:00:00Z");
    const a = await storage.presignGet(key, { windowSeconds: 3600, now: t0 });
    const b = await storage.presignGet(key, {
      windowSeconds: 3600,
      now: new Date(t0.getTime() + 3_000_000),
    });
    const c = await storage.presignGet(key, {
      windowSeconds: 3600,
      now: new Date(t0.getTime() + 3_700_000),
    });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});

describe("výběr úložiště", () => {
  const r2 = {
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET: "bucket",
  };

  it("s proměnnými R2 je to R2", () => {
    expect(resolveStorage({ ...r2, NODE_ENV: "production" }).kind).toBe("r2");
  });

  it("mimo produkci bez R2 je to paměť, sdílená mezi voláními", () => {
    const first = resolveStorage({ NODE_ENV: "development" });
    expect(first.kind).toBe("memory");
    expect(resolveStorage({ NODE_ENV: "test" })).toBe(first);
  });

  it("e2e (produkční sestavení) zapíná paměť výslovně, ale nikdy na produkci Vercelu", () => {
    const e2e = { NODE_ENV: "production", STORAGE_DRIVER: "memory" };
    // bez opt-in (ALLOW_TEST_HATCHES=1) paměť v produkčním sestavení nefunguje
    expect(resolveStorage(e2e).kind).toBe("unconfigured");
    expect(resolveStorage({ ...e2e, ALLOW_TEST_HATCHES: "1" }).kind).toBe("memory");
    expect(resolveStorage({ ...e2e, ALLOW_TEST_HATCHES: "1", VERCEL_ENV: "production" }).kind).toBe(
      "unconfigured",
    );
  });

  it("v produkci bez R2 selže až použití fotografií, výpis a mazání nic nedělají", async () => {
    const storage = resolveStorage({ NODE_ENV: "production", R2_BUCKET: "bucket" });
    expect(storage.kind).toBe("unconfigured");
    expect(await storage.listPrefix(A)).toEqual([]);
    expect(await storage.deletePrefix(A)).toEqual({ deleted: 0 });
    await expect(
      storage.presignPut(incomingKey(A, M), {
        contentType: "image/png",
        bytes: 10,
        expiresInSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: "not_configured",
      message: expect.stringContaining("R2_ACCOUNT_ID"),
    });
    await expect(storage.getObject(incomingKey(A, M), { maxBytes: 1 })).rejects.toMatchObject({
      code: "not_configured",
    });
    await expect(storage.deleteMedia(A, M)).rejects.toMatchObject({ code: "not_configured" });
    await expect(storage.deletePrefix("")).rejects.toThrow();
  });

  it("zpráva o chybějícím nastavení jmenuje jen názvy proměnných, žádné hodnoty", async () => {
    const storage = createUnconfiguredStorage(["R2_ACCOUNT_ID", "R2_BUCKET"]);
    await expect(
      storage.putObject(incomingKey(A, M), Buffer.alloc(1), { contentType: "x" }),
    ).rejects.toThrow(/Chybí: R2_ACCOUNT_ID, R2_BUCKET/);
  });

  it("jde nahradit pro test a vrátit", () => {
    const storage = createMemoryStorage();
    setStorage(storage);
    expect(getStorage()).toBe(storage);
    expect(storageKind()).toBe("memory");
    setStorage(null);
    expect(getStorage()).not.toBe(storage);
    expect(noopStorage.kind).toBe("unconfigured");
  });
});
