import { describe, expect, it } from "vitest";
import {
  OG_IMAGE_LIMITS,
  fetchOgImage,
  type OgDeps,
  type PageRequest,
  type PageResponse,
} from "./og";

/**
 * Obrázek karty externí galerie (M7c): stahuje ho SERVER se stejnými zárukami proti SSRF jako kartu (jen https na
 * portu 443, žádné soukromé adresy ani po přesměrování, časový limit), jen typ JPEG, PNG nebo WebP a se stropem
 * velikosti. Doprava je vyměnitelná, takže se žádná skutečná síť nepoužívá.
 */

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

type Reply = {
  status?: number;
  headers?: Record<string, string>;
  body?: AsyncIterable<Uint8Array>;
  hang?: boolean;
};

async function* chunks(...parts: Uint8Array[]) {
  for (const part of parts) yield part;
}

const image = (type = "image/png", body: Buffer = PNG): Reply => ({
  headers: { "content-type": type },
  body: chunks(body),
});

function fakeDeps(
  routes: Record<string, Reply>,
  dns: Record<string, string[]> = {},
  extra: Partial<OgDeps> = {},
) {
  const requests: { url: string; address: string; accept?: string }[] = [];
  const deps: Partial<OgDeps> = {
    testHost: null,
    timeoutMs: 400,
    async resolve(hostname) {
      return dns[hostname] ?? ["93.184.216.34"];
    },
    async request({ url, address, signal, accept }: PageRequest): Promise<PageResponse> {
      requests.push({ url: url.toString(), address, accept });
      const route = routes[url.toString()];
      if (!route) throw new Error("ECONNREFUSED");
      if (route.hang) {
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("abort"))),
        );
      }
      return {
        status: route.status ?? 200,
        headers: { ...route.headers },
        body: route.body ?? chunks(),
        destroy() {},
      };
    },
    ...extra,
  };
  return { deps, requests };
}

describe("fetchOgImage", () => {
  it("stáhne obrázek, spojí se na ověřenou adresu a pošle Accept jen pro obrázky", async () => {
    const { deps, requests } = fakeDeps({ "https://cdn.example/cover.png": image() });
    const result = await fetchOgImage("https://cdn.example/cover.png", deps);
    expect(result).toEqual({ ok: true, data: PNG, contentType: "image/png" });
    expect(requests).toEqual([
      {
        url: "https://cdn.example/cover.png",
        address: "93.184.216.34",
        accept: "image/jpeg,image/png,image/webp;q=0.9",
      },
    ]);
  });

  it.each([
    "http://cdn.example/a.png",
    "https://127.0.0.1/a.png",
    "https://localhost/a.png",
    "https://cdn.example:8443/a.png",
    "https://u:p@cdn.example/a.png",
    "neni url",
  ])("odmítne %s bez jediného požadavku", async (url) => {
    const { deps, requests } = fakeDeps({});
    expect(await fetchOgImage(url, deps)).toEqual({ ok: false, reason: "invalid_url" });
    expect(requests).toEqual([]);
  });

  it("jméno překládané na soukromou adresu se odmítne (i když je jedna adresa veřejná)", async () => {
    const { deps, requests } = fakeDeps(
      { "https://cdn.example/a.png": image() },
      { "cdn.example": ["93.184.216.34", "10.0.0.5"] },
    );
    expect(await fetchOgImage("https://cdn.example/a.png", deps)).toEqual({
      ok: false,
      reason: "blocked",
    });
    expect(requests).toEqual([]);
  });

  it("přesměrování na loopback, metadata cloudu, soukromé jméno nebo http se odmítne po každém skoku", async () => {
    for (const location of [
      "https://127.0.0.1/a.png",
      "https://169.254.169.254/latest/meta-data",
      "https://interni.example/a.png",
      "http://cdn.example/a.png",
    ]) {
      const { deps } = fakeDeps(
        {
          "https://cdn.example/a.png": { status: 302, headers: { location } },
          "https://interni.example/a.png": image(),
        },
        { "interni.example": ["192.168.1.10"] },
      );
      expect(await fetchOgImage("https://cdn.example/a.png", deps)).toMatchObject({
        ok: false,
        reason: "blocked",
      });
    }
  });

  it("povolí nejvýš 3 přesměrování", async () => {
    const tooMany = fakeDeps({
      "https://cdn.example/1": { status: 301, headers: { location: "/2" } },
      "https://cdn.example/2": { status: 301, headers: { location: "/3" } },
      "https://cdn.example/3": { status: 301, headers: { location: "/4" } },
      "https://cdn.example/4": { status: 301, headers: { location: "/5" } },
      "https://cdn.example/5": image(),
    });
    expect(await fetchOgImage("https://cdn.example/1", tooMany.deps)).toEqual({
      ok: false,
      reason: "redirects",
    });
    const ok = fakeDeps({
      "https://cdn.example/1": { status: 301, headers: { location: "/2" } },
      "https://cdn.example/2": image("image/webp"),
    });
    expect(await fetchOgImage("https://cdn.example/1", ok.deps)).toMatchObject({ ok: true });
  });

  it.each([
    "image/svg+xml",
    "text/html",
    "image/gif",
    "application/octet-stream",
    "image/avif",
    "",
  ])("odmítne typ %j (SVG ani nic jiného než JPEG, PNG a WebP)", async (type) => {
    const { deps } = fakeDeps({ "https://cdn.example/a": image(type) });
    expect(await fetchOgImage("https://cdn.example/a", deps)).toEqual({
      ok: false,
      reason: "not_image",
    });
  });

  it("typ s parametrem projde, komprese ne", async () => {
    const good = fakeDeps({ "https://cdn.example/a": image("IMAGE/JPEG; charset=binary") });
    expect(await fetchOgImage("https://cdn.example/a", good.deps)).toMatchObject({
      ok: true,
      contentType: "image/jpeg",
    });
    const gz = fakeDeps({
      "https://cdn.example/a": {
        headers: { "content-type": "image/png", "content-encoding": "gzip" },
        body: chunks(PNG),
      },
    });
    expect(await fetchOgImage("https://cdn.example/a", gz.deps)).toMatchObject({
      ok: false,
      reason: "not_image",
    });
  });

  it("chyba serveru, prázdné tělo a nedostupný server jsou selhání, ne výjimka", async () => {
    const down = fakeDeps({ "https://cdn.example/a": { status: 404 } });
    expect(await fetchOgImage("https://cdn.example/a", down.deps)).toEqual({
      ok: false,
      reason: "status",
    });
    const empty = fakeDeps({ "https://cdn.example/a": image("image/png", Buffer.alloc(0)) });
    expect(await fetchOgImage("https://cdn.example/a", empty.deps)).toEqual({
      ok: false,
      reason: "not_image",
    });
    const dead = fakeDeps({});
    expect(await fetchOgImage("https://cdn.example/a", dead.deps)).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("strop velikosti: podle hlavičky i podle skutečně přijatých bajtů", async () => {
    const declared = fakeDeps({
      "https://cdn.example/a": {
        headers: {
          "content-type": "image/png",
          "content-length": String(OG_IMAGE_LIMITS.maxBytes + 1),
        },
        body: chunks(PNG),
      },
    });
    expect(await fetchOgImage("https://cdn.example/a", declared.deps)).toEqual({
      ok: false,
      reason: "too_large",
    });

    let destroyed = false;
    const chunk = Buffer.alloc(1024 * 1024);
    const { deps } = fakeDeps(
      {},
      {},
      {
        async request(): Promise<PageResponse> {
          return {
            status: 200,
            // hlavička chybí nebo lže: strop se hlídá při čtení
            headers: { "content-type": "image/png" },
            body: (async function* () {
              for (let i = 0; i < 100; i++) yield chunk;
            })(),
            destroy() {
              destroyed = true;
            },
          };
        },
      },
    );
    expect(await fetchOgImage("https://cdn.example/a", deps)).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(destroyed).toBe(true);
  });

  it("server, který neodpovídá, skončí časovým limitem", async () => {
    const { deps } = fakeDeps({ "https://cdn.example/a": { hang: true } });
    expect(await fetchOgImage("https://cdn.example/a", { ...deps, timeoutMs: 100 })).toEqual({
      ok: false,
      reason: "timeout",
    });
  });
});
