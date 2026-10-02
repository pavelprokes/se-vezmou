import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createR2Storage,
  parseDeleteErrors,
  parseListPage,
  r2ConfigFromEnv,
  r2OriginFromEnv,
  type R2Config,
} from "./r2";
import { incomingKey, variantKey, StorageTooLargeError } from "./types";

const A = "0b6a1c1e-3b5e-4d0c-9a1f-0d3c7e9a1b11";
const B = "7c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5";
const M = "9d2f1a40-5b6c-4d7e-8f90-a1b2c3d4e5f6";

const config: R2Config = {
  accountId: "acct",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "super-secret-value",
  bucket: "se-vezmou-photos",
  endpoint: "https://acct.eu.r2.cloudflarestorage.com",
  region: "auto",
};

type Call = { method: string; url: URL; headers: Headers; body: string };
let calls: Call[];
let responder: (call: Call) => Response | Promise<Response>;

beforeEach(() => {
  calls = [];
  responder = () => new Response("", { status: 200 });
  vi.stubGlobal("fetch", async (input: Request) => {
    const call: Call = {
      method: input.method,
      url: new URL(input.url),
      headers: input.headers,
      body: input.method === "POST" || input.method === "PUT" ? await input.clone().text() : "",
    };
    calls.push(call);
    return responder(call);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("nastavení R2 z prostředí", () => {
  const full = {
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "id",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET: "bucket",
  };

  it("odvodí adresu EU a oblast auto, když nejsou zadané", () => {
    const result = r2ConfigFromEnv(full);
    expect(result).toEqual({
      status: "ok",
      config: {
        accountId: "acct",
        accessKeyId: "id",
        secretAccessKey: "secret",
        bucket: "bucket",
        endpoint: "https://acct.eu.r2.cloudflarestorage.com",
        region: "auto",
      },
    });
  });

  it("přijme vlastní adresu a oblast, odřízne lomítko na konci", () => {
    const result = r2ConfigFromEnv({
      ...full,
      R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com/",
      S3_REGION: "eeur",
    });
    expect(result.status === "ok" && result.config.endpoint).toBe(
      "https://acct.r2.cloudflarestorage.com",
    );
    expect(result.status === "ok" && result.config.region).toBe("eeur");
  });

  it("vypíše, co chybí (jen názvy), a rozliší nenastavené od částečně nastaveného", () => {
    expect(r2ConfigFromEnv({})).toEqual({
      status: "missing",
      anySet: false,
      missing: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"],
    });
    const partial = r2ConfigFromEnv({ R2_ACCOUNT_ID: "x", R2_BUCKET: "  " });
    expect(partial.status === "missing" && partial.anySet).toBe(true);
    expect(partial.status === "missing" && partial.missing).toEqual([
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
    ]);
  });

  it("adresa jiná než https je chyba nastavení", () => {
    const result = r2ConfigFromEnv({ ...full, R2_ENDPOINT: "http://acct.example" });
    expect(result.status).toBe("missing");
    expect(r2OriginFromEnv({ ...full, R2_ENDPOINT: "ftp://x" })).toBeNull();
    expect(r2OriginFromEnv({ ...full })).toBe("https://acct.eu.r2.cloudflarestorage.com");
    expect(r2OriginFromEnv({})).toBeNull();
  });
});

describe("podepsané adresy", () => {
  it("nahrávání: PUT do karantény s platností v adrese a bez prozrazení tajné hodnoty", async () => {
    const storage = createR2Storage(config);
    const target = await storage.presignPut(incomingKey(A, M), {
      contentType: "image/jpeg",
      expiresInSeconds: 600,
    });
    const url = new URL(target.url);
    expect(url.origin).toBe("https://acct.eu.r2.cloudflarestorage.com");
    expect(url.pathname).toBe(`/se-vezmou-photos/incoming/${A}/${M}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(
      /^AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request$/,
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(target.url).not.toContain("super-secret-value");
    expect(target.method).toBe("PUT");
    expect(target.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(target.expiresInSeconds).toBe(600);
  });

  it("nahrávat lze jen do karantény, nikdy do předpony svatby", async () => {
    const storage = createR2Storage(config);
    await expect(
      storage.presignPut(variantKey(A, M, 640, "webp"), {
        contentType: "image/webp",
        expiresInSeconds: 60,
      }),
    ).rejects.toThrow();
    await expect(
      storage.presignPut(`${A}/../${B}/x`, { contentType: "image/webp", expiresInSeconds: 60 }),
    ).rejects.toThrow();
  });

  it("čtení: adresa je po dobu časového okna stejná a platí dvě okna", async () => {
    const storage = createR2Storage(config);
    const key = variantKey(A, M, 1280, "avif");
    const t0 = new Date("2027-03-04T10:00:00Z");
    const first = await storage.presignGet(key, { windowSeconds: 3600, now: t0 });
    const later = await storage.presignGet(key, {
      windowSeconds: 3600,
      now: new Date(t0.getTime() + 59 * 60 * 1000),
    });
    const next = await storage.presignGet(key, {
      windowSeconds: 3600,
      now: new Date(t0.getTime() + 61 * 60 * 1000),
    });
    expect(later).toBe(first);
    expect(next).not.toBe(first);
    const url = new URL(first);
    expect(url.searchParams.get("X-Amz-Date")).toBe("20270304T100000Z");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("7200");
    expect(url.pathname).toBe(`/se-vezmou-photos/${A}/${M}/1280.avif`);
  });

  it("stažení přidá název souboru bezpečně a podpis se změní", async () => {
    const storage = createR2Storage(config);
    const key = variantKey(A, M, 1920, "webp");
    const plain = await storage.presignGet(key, { windowSeconds: 3600 });
    const named = await storage.presignGet(key, {
      windowSeconds: 3600,
      downloadName: 'foto "1"\r\n.webp',
    });
    expect(named).not.toBe(plain);
    const disposition = new URL(named).searchParams.get("response-content-disposition");
    expect(disposition).toBe('attachment; filename="foto__1___.webp"');
  });

  it("neplatný klíč podpis nedostane", async () => {
    const storage = createR2Storage(config);
    await expect(storage.presignGet(`${A}/foto/1.webp`, { windowSeconds: 3600 })).rejects.toThrow();
    await expect(storage.presignGet("../x", { windowSeconds: 3600 })).rejects.toThrow();
  });
});

describe("výpis a mazání", () => {
  const listXml = (keys: string[], truncated: boolean, token = "") =>
    `<?xml version="1.0"?><ListBucketResult><IsTruncated>${truncated}</IsTruncated>${
      token ? `<NextContinuationToken>${token}</NextContinuationToken>` : ""
    }${keys.map((k, i) => `<Contents><Key>${k}</Key><Size>${100 + i}</Size></Contents>`).join("")}</ListBucketResult>`;

  it("rozebere stránku výpisu a chyby mazání", () => {
    expect(parseListPage(listXml(["a&amp;b"], true, "tok&amp;1"))).toEqual({
      objects: [{ key: "a&b", bytes: 100 }],
      truncated: true,
      next: "tok&1",
    });
    expect(
      parseDeleteErrors(
        "<DeleteResult><Error><Key>x/1</Key><Code>AccessDenied</Code></Error></DeleteResult>",
      ),
    ).toEqual(["x/1"]);
    expect(parseDeleteErrors("<DeleteResult></DeleteResult>")).toEqual([]);
  });

  it("výpis svatby prochází stránky a posílá předponu {wedding_id}/", async () => {
    const storage = createR2Storage(config);
    responder = (call) =>
      new Response(
        call.url.searchParams.get("continuation-token")
          ? listXml([`${A}/${M}/1280.webp`], false)
          : listXml([`${A}/${M}/640.webp`, `${A}/${M}/640.avif`], true, "t2"),
        { status: 200 },
      );
    const objects = await storage.listPrefix(A);
    expect(objects.map((o) => o.key)).toEqual([
      `${A}/${M}/640.webp`,
      `${A}/${M}/640.avif`,
      `${A}/${M}/1280.webp`,
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url.searchParams.get("prefix")).toBe(`${A}/`);
    expect(calls[0].url.searchParams.get("list-type")).toBe("2");
    expect(calls[1].url.searchParams.get("continuation-token")).toBe("t2");
    expect(calls[0].headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//,
    );
  });

  it("výpis zahodí klíč mimo žádanou předponu (pojistka)", async () => {
    const storage = createR2Storage(config);
    responder = () => new Response(listXml([`${B}/${M}/640.webp`, `${A}/${M}/640.webp`], false));
    expect((await storage.listPrefix(A)).map((o) => o.key)).toEqual([`${A}/${M}/640.webp`]);
  });

  it("smazání svatby vypíše a smaže předponu i karanténu, DeleteObjects s MD5", async () => {
    const storage = createR2Storage(config);
    responder = (call) => {
      if (call.method === "GET") {
        const prefix = call.url.searchParams.get("prefix");
        return new Response(
          prefix === `${A}/`
            ? listXml([`${A}/${M}/640.webp`], false)
            : listXml([`incoming/${A}/${M}`], false),
        );
      }
      return new Response("<DeleteResult></DeleteResult>");
    };
    expect(await storage.deletePrefix(A)).toEqual({ deleted: 2 });
    const del = calls.filter((c) => c.method === "POST");
    expect(del).toHaveLength(1);
    expect(del[0].url.search).toBe("?delete");
    expect(del[0].body).toContain(`<Key>${A}/${M}/640.webp</Key>`);
    expect(del[0].body).toContain(`<Key>incoming/${A}/${M}</Key>`);
    expect(del[0].headers.get("content-md5")).toBe(
      createHash("md5").update(del[0].body).digest("base64"),
    );
    expect(calls.map((c) => c.url.searchParams.get("prefix")).filter(Boolean)).toEqual([
      `${A}/`,
      `incoming/${A}/`,
    ]);
  });

  it("mazání po tisících klíčů", async () => {
    const storage = createR2Storage(config);
    const keys = Array.from({ length: 2500 }, (_, i) => `${A}/${M}/${i + 16}.webp`);
    responder = () => new Response("<DeleteResult></DeleteResult>");
    await storage.deleteObjects(keys);
    expect(calls.map((c) => (c.body.match(/<Object>/g) ?? []).length)).toEqual([1000, 1000, 500]);
  });

  it("chyba mazání jednoho kusu je vyhozená chyba (web se nesmí označit za vymazaný)", async () => {
    const storage = createR2Storage(config);
    responder = (call) =>
      call.method === "GET"
        ? new Response(listXml([`${A}/${M}/640.webp`], false))
        : new Response(
            `<DeleteResult><Error><Key>${A}/${M}/640.webp</Key><Code>InternalError</Code></Error></DeleteResult>`,
          );
    await expect(storage.deletePrefix(A)).rejects.toMatchObject({ code: "storage_failed" });
  });

  it("odmítnutí úložištěm i výpadek sítě jsou chyba bez adresy a klíčů ve zprávě", async () => {
    const storage = createR2Storage(config);
    responder = () => new Response("nope", { status: 403 });
    const error = await storage.listPrefix(A).catch((e: Error) => e);
    expect(error).toMatchObject({ code: "storage_failed" });
    expect((error as Error).message).not.toContain(A);
    expect((error as Error).message).not.toContain("se-vezmou-photos");
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNRESET https://acct.eu.r2.cloudflarestorage.com secret");
    });
    const networkError = await storage.deletePrefix(A).catch((e: Error) => e);
    expect(networkError).toMatchObject({ code: "storage_failed" });
    expect((networkError as Error).message).not.toContain("ECONNRESET");
  });

  it("smazání média smaže originál v karanténě i varianty", async () => {
    const storage = createR2Storage(config);
    responder = (call) =>
      call.method === "GET"
        ? new Response(listXml([`${A}/${M}/640.webp`, `${A}/${M}/640.avif`], false))
        : new Response("<DeleteResult></DeleteResult>");
    await storage.deleteMedia(A, M);
    expect(calls[0].url.searchParams.get("prefix")).toBe(`${A}/${M}/`);
    const body = calls.find((c) => c.method === "POST")!.body;
    expect(body).toContain(`incoming/${A}/${M}`);
    expect(body).toContain(`${A}/${M}/640.avif`);
  });
});

describe("čtení a zápis objektů", () => {
  it("head: velikost, nebo null pro neexistující", async () => {
    const storage = createR2Storage(config);
    responder = () => new Response("", { status: 200, headers: { "content-length": "1234" } });
    expect(await storage.headObject(incomingKey(A, M))).toEqual({ bytes: 1234 });
    expect(calls[0].method).toBe("HEAD");
    responder = () => new Response("", { status: 404 });
    expect(await storage.headObject(incomingKey(A, M))).toBeNull();
  });

  it("čtení: obsah, null pro neexistující, a pevný strop velikosti", async () => {
    const storage = createR2Storage(config);
    responder = () => new Response("obsah", { status: 200 });
    expect((await storage.getObject(incomingKey(A, M), { maxBytes: 100 }))?.toString()).toBe(
      "obsah",
    );
    responder = () => new Response("", { status: 404 });
    expect(await storage.getObject(incomingKey(A, M), { maxBytes: 100 })).toBeNull();
    // hlavička Content-Length nad limitem: nečte se vůbec
    responder = () => new Response("x", { status: 200, headers: { "content-length": "999999" } });
    await expect(storage.getObject(incomingKey(A, M), { maxBytes: 1000 })).rejects.toBeInstanceOf(
      StorageTooLargeError,
    );
    // bez hlavičky: strop se hlídá při čtení proudu
    responder = () => new Response(new Blob([new Uint8Array(5000)]).stream(), { status: 200 });
    await expect(storage.getObject(incomingKey(A, M), { maxBytes: 1000 })).rejects.toBeInstanceOf(
      StorageTooLargeError,
    );
  });

  it("zápis: typ obsahu a cache, jen známý tvar klíče", async () => {
    const storage = createR2Storage(config);
    await storage.putObject(variantKey(A, M, 640, "webp"), Buffer.from("data"), {
      contentType: "image/webp",
      cacheControl: "private, max-age=3600",
    });
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].headers.get("content-type")).toBe("image/webp");
    expect(calls[0].headers.get("cache-control")).toBe("private, max-age=3600");
    await expect(
      storage.putObject(`${A}/foto/1.webp`, Buffer.alloc(1), { contentType: "image/webp" }),
    ).rejects.toThrow();
  });

  it("chyba zápisu je chyba úložiště", async () => {
    const storage = createR2Storage(config);
    responder = () => new Response("", { status: 500 });
    await expect(
      storage.putObject(variantKey(A, M, 640, "webp"), Buffer.alloc(1), {
        contentType: "image/webp",
      }),
    ).rejects.toMatchObject({ code: "storage_failed" });
  });
});
