import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanOgText,
  fetchOgCard,
  isAllowedTarget,
  isPublicAddress,
  OG_LIMITS,
  parseOgCard,
  parseTestHost,
  type OgDeps,
  type PageRequest,
  type PageResponse,
} from "./og";

const NOW = new Date("2026-10-02T10:00:00Z");

describe("isPublicAddress: kdy se smí spojit", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "192.0.2.10",
    "198.18.0.1",
    "203.0.113.9",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::1",
    "neni-adresa",
    "",
  ])("odmítne %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "172.32.0.1",
    "100.63.0.1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ])("povolí %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe("isAllowedTarget: tvar adresy", () => {
  const ok = (value: string) => isAllowedTarget(new URL(value));

  it("povolí https na portu 443 se jménem hostitele", () => {
    expect(ok("https://fotky.example/svatba")).toBe(true);
    expect(ok("https://fotky.example:443/svatba")).toBe(true);
    expect(ok("https://www.fotky.example/a?b=1#c")).toBe(true);
  });

  it.each([
    "http://fotky.example/",
    "ftp://fotky.example/",
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "https://fotky.example:8443/",
    "https://fotky.example:80/",
    "https://user:heslo@fotky.example/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://10.0.0.5/",
    "https://2130706433/",
    "https://localhost/",
    "https://localhost:443/",
    "https://sluzba.localhost/",
    "https://intranet/",
    "https://tiskarna.local/",
    "https://stroj.internal/",
  ])("odmítne %s", (value) => {
    expect(ok(value)).toBe(false);
  });

  it("tvar adresy nemá žádnou výjimku", () => {
    expect(isAllowedTarget(new URL("http://127.0.0.1:4555/og"))).toBe(false);
    expect(isAllowedTarget(new URL("https://127.0.0.1:4555/og"))).toBe(false);
  });
});

describe("cleanOgText: nedůvěryhodný text", () => {
  it("dekóduje entity, odstraní řídicí a směrové znaky, sjednotí mezery a zkrátí", () => {
    expect(cleanOgText("  Svatba &amp; hostina&#33; &#x41;\u0000‮  \n tabulka ", 200)).toBe(
      "Svatba & hostina! A tabulka",
    );
    expect(cleanOgText("x".repeat(500), 50)?.length).toBe(50);
    expect(cleanOgText("   ", 50)).toBeNull();
    expect(cleanOgText(undefined, 50)).toBeNull();
  });

  it("značky v textu zůstanou textem (zobrazí se escapované)", () => {
    expect(cleanOgText("<script>alert(1)</script>", 200)).toBe("<script>alert(1)</script>");
  });
});

describe("parseOgCard", () => {
  const page = new URL("https://fotky.example/svatba/");

  it("načte og:title, og:description a og:image (i v obráceném pořadí atributů)", () => {
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <title>Nepoužije se</title>
      <meta property="og:title" content="Svatba Kláry a Matěje">
      <meta content='Fotky &amp; videa z obřadu' property='og:description'>
      <meta property="og:image" content="/img/cover.jpg">
      </head><body><p>nic</p></body></html>`;
    expect(parseOgCard(html, page, NOW)).toEqual({
      title: "Svatba Kláry a Matěje",
      description: "Fotky & videa z obřadu",
      imageUrl: "https://fotky.example/img/cover.jpg",
      fetchedAt: "2026-10-02T10:00:00.000Z",
      imageMediaId: null,
      status: "ok",
    });
  });

  it("bez og značek použije <title> a meta description", () => {
    const card = parseOgCard(
      '<html><head><title> Galerie </title><meta name="description" content="Popis"></head></html>',
      page,
      NOW,
    );
    expect(card).toMatchObject({ title: "Galerie", description: "Popis", imageUrl: null });
  });

  it("obrázek jen přes https, jinak null; značky v <body> se ignorují", () => {
    const html = `<head><meta property="og:title" content="A"><meta property="og:image" content="http://x.example/a.jpg"></head>
      <body><meta property="og:title" content="Podvrh"></body>`;
    const card = parseOgCard(html, page, NOW);
    expect(card?.title).toBe("A");
    expect(card?.imageUrl).toBeNull();
    expect(
      parseOgCard(
        '<head><meta property="og:image" content="javascript:alert(1)"></head>',
        page,
        NOW,
      ),
    ).toBeNull();
  });

  it("nic použitelného je null", () => {
    expect(parseOgCard("<html><head></head><body>Ahoj</body></html>", page, NOW)).toBeNull();
  });
});

// --- načtení s vyměnitelnou dopravou ---------------------------------------------------------------

type Reply = {
  status?: number;
  headers?: Record<string, string>;
  body?: string | AsyncIterable<Uint8Array>;
  hang?: boolean;
};

function fakeDeps(
  routes: Record<string, Reply>,
  dns: Record<string, string[]> = {},
  extra: Partial<OgDeps> = {},
) {
  const requests: { url: string; address: string }[] = [];
  const deps: Partial<OgDeps> = {
    testHost: null,
    now: () => NOW,
    timeoutMs: 400,
    async resolve(hostname) {
      return dns[hostname] ?? ["93.184.216.34"];
    },
    async request({ url, address, signal }: PageRequest): Promise<PageResponse> {
      requests.push({ url: url.toString(), address });
      const route = routes[url.toString()];
      if (!route) throw new Error("ECONNREFUSED");
      if (route.hang) {
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("abort"))),
        );
      }
      const body = route.body ?? "";
      return {
        status: route.status ?? 200,
        headers: { "content-type": "text/html; charset=utf-8", ...route.headers },
        body:
          typeof body === "string"
            ? (async function* () {
                yield Buffer.from(body);
              })()
            : body,
        destroy() {},
      };
    },
    ...extra,
  };
  return { deps, requests };
}

const HTML = `<html><head><meta property="og:title" content="Galerie"></head><body></body></html>`;

describe("fetchOgCard: ochrana před SSRF", () => {
  it("načte kartu a spojí se na ověřenou adresu", async () => {
    const { deps, requests } = fakeDeps({ "https://fotky.example/a": { body: HTML } });
    const result = await fetchOgCard("https://fotky.example/a", deps);
    expect(result).toMatchObject({ ok: true, card: { title: "Galerie", status: "ok" } });
    expect(requests).toEqual([{ url: "https://fotky.example/a", address: "93.184.216.34" }]);
  });

  it.each([
    ["http://fotky.example/a", "invalid_url"],
    ["javascript:alert(1)", "invalid_url"],
    ["https://127.0.0.1/a", "invalid_url"],
    ["https://localhost/a", "invalid_url"],
    ["https://fotky.example:8443/a", "invalid_url"],
    ["https://u:p@fotky.example/a", "invalid_url"],
    ["neni url", "invalid_url"],
  ])("odmítne %s bez jediného požadavku", async (url, reason) => {
    const { deps, requests } = fakeDeps({});
    const result = await fetchOgCard(url, deps);
    expect(result).toMatchObject({ ok: false, reason, card: { status: "failed" } });
    expect(requests).toEqual([]);
  });

  it("jméno, které se překládá na soukromou adresu, se odmítne (i když je jedna adresa veřejná)", async () => {
    for (const addresses of [
      ["127.0.0.1"],
      ["10.0.0.5"],
      ["169.254.169.254"],
      ["93.184.216.34", "10.0.0.5"],
      ["::1"],
      ["::ffff:127.0.0.1"],
    ]) {
      const { deps, requests } = fakeDeps(
        { "https://zlo.example/a": { body: HTML } },
        { "zlo.example": addresses },
      );
      const result = await fetchOgCard("https://zlo.example/a", deps);
      expect(result).toMatchObject({ ok: false, reason: "blocked" });
      expect(requests).toEqual([]);
    }
  });

  it("přesměrování na 127.0.0.1 se odmítne", async () => {
    const { deps, requests } = fakeDeps({
      "https://fotky.example/a": { status: 302, headers: { location: "https://127.0.0.1/admin" } },
      "https://127.0.0.1/admin": { body: HTML },
    });
    const result = await fetchOgCard("https://fotky.example/a", deps);
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
    expect(requests.map((r) => r.url)).toEqual(["https://fotky.example/a"]);
  });

  it.each([
    "http://fotky.example/b",
    "https://fotky.example:8080/b",
    "https://localhost/b",
    "javascript:alert(1)",
    "file:///etc/passwd",
  ])("přesměrování na %s se odmítne", async (location) => {
    const { deps, requests } = fakeDeps({
      "https://fotky.example/a": { status: 301, headers: { location } },
      [location]: { body: HTML },
    });
    const result = await fetchOgCard("https://fotky.example/a", deps);
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
    expect(requests).toHaveLength(1);
  });

  it("přesměrování na jméno, které se překládá na soukromou adresu, se odmítne (kontrola po každém skoku)", async () => {
    const { deps, requests } = fakeDeps(
      {
        "https://fotky.example/a": {
          status: 302,
          headers: { location: "https://vnitrni.example/x" },
        },
        "https://vnitrni.example/x": { body: HTML },
      },
      { "vnitrni.example": ["192.168.0.10"] },
    );
    const result = await fetchOgCard("https://fotky.example/a", deps);
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
    expect(requests.map((r) => r.url)).toEqual(["https://fotky.example/a"]);
  });

  it("povolí nejvýš 3 přesměrování a relativní Location", async () => {
    const ok = fakeDeps({
      "https://fotky.example/1": { status: 302, headers: { location: "/2" } },
      "https://fotky.example/2": { status: 301, headers: { location: "https://cdn.example/3" } },
      "https://cdn.example/3": { status: 307, headers: { location: "https://cdn.example/4" } },
      "https://cdn.example/4": { body: HTML },
    });
    expect(await fetchOgCard("https://fotky.example/1", ok.deps)).toMatchObject({ ok: true });
    expect(ok.requests).toHaveLength(4);

    const loop = fakeDeps({
      "https://fotky.example/1": { status: 302, headers: { location: "/1" } },
    });
    expect(await fetchOgCard("https://fotky.example/1", loop.deps)).toMatchObject({
      ok: false,
      reason: "redirects",
    });
    expect(loop.requests).toHaveLength(OG_LIMITS.maxRedirects + 1);
  });

  it("odmítne jiný typ než text/html, kompresi, chybu serveru a prázdnou hlavičku", async () => {
    const cases: [Reply, string][] = [
      [{ headers: { "content-type": "application/pdf" }, body: HTML }, "not_html"],
      [{ headers: { "content-type": "image/png" }, body: "x" }, "not_html"],
      [{ headers: { "content-encoding": "gzip" }, body: HTML }, "not_html"],
      [{ status: 403, body: HTML }, "status"],
      [{ status: 404, body: HTML }, "status"],
      [{ status: 302 }, "status"],
      [{ body: "<html><head></head><body>nic</body></html>" }, "no_tags"],
    ];
    for (const [reply, reason] of cases) {
      const { deps } = fakeDeps({ "https://fotky.example/a": reply });
      const result = await fetchOgCard("https://fotky.example/a", deps);
      expect(result, reason).toMatchObject({ ok: false, reason, card: { status: "failed" } });
    }
  });

  it("příliš velká odpověď bez konce <head> v limitu se odmítne, malá hlavička v obří stránce projde", async () => {
    const huge = (async function* () {
      for (let i = 0; i < 20; i++) yield Buffer.alloc(64 * 1024, "a");
    })();
    const big = fakeDeps({ "https://fotky.example/a": { body: huge } });
    expect(await fetchOgCard("https://fotky.example/a", big.deps)).toMatchObject({
      ok: false,
      reason: "too_large",
    });

    const early = (async function* () {
      yield Buffer.from(HTML);
      for (let i = 0; i < 100; i++) yield Buffer.alloc(64 * 1024, "a");
    })();
    const fine = fakeDeps({ "https://fotky.example/a": { body: early } });
    expect(await fetchOgCard("https://fotky.example/a", fine.deps)).toMatchObject({ ok: true });

    const declared = fakeDeps({
      "https://fotky.example/a": {
        headers: { "content-length": String(50 * 1024 * 1024) },
        body: HTML,
      },
    });
    expect(await fetchOgCard("https://fotky.example/a", declared.deps)).toMatchObject({
      ok: false,
      reason: "too_large",
    });
  });

  it("časový limit: server, který neodpovídá, skončí chybou timeout", async () => {
    const { deps } = fakeDeps({ "https://pomaly.example/a": { hang: true } });
    const started = Date.now();
    const result = await fetchOgCard("https://pomaly.example/a", { ...deps, timeoutMs: 150 });
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("nedostupný server není výjimka, ale selhání se stavem failed", async () => {
    const { deps } = fakeDeps({});
    expect(await fetchOgCard("https://nikdo.example/a", deps)).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
  });

  it("DNS bez odpovědi je unreachable, výjimka DNS taky", async () => {
    const empty = fakeDeps({}, { "prazdny.example": [] });
    expect(await fetchOgCard("https://prazdny.example/a", empty.deps)).toMatchObject({
      reason: "unreachable",
    });
    const broken = fakeDeps(
      {},
      {},
      {
        async resolve() {
          throw new Error("ENOTFOUND");
        },
      },
    );
    expect(await fetchOgCard("https://nic.example/a", broken.deps)).toMatchObject({
      reason: "unreachable",
    });
  });
});

describe("parseTestHost: výjimka jen pro loopback", () => {
  it("přijme jméno=127.0.0.1:port, jiný cíl ignoruje", () => {
    expect(parseTestHost("fotky-test.example=127.0.0.1:4555")).toEqual({
      hostname: "fotky-test.example",
      address: "127.0.0.1",
      port: 4555,
    });
    for (const value of [
      undefined,
      "",
      "fotky.example=10.0.0.5:80",
      "fotky.example=93.184.216.34:80",
      "fotky.example=localhost:80",
      "localhost=127.0.0.1:80",
      "127.0.0.1=127.0.0.1:80",
      "fotky.example=127.0.0.1",
    ]) {
      expect(parseTestHost(value)).toBeNull();
    }
  });
});

describe("fetchOgCard: skutečná doprava proti lokálnímu serveru (jediná výjimka)", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function start(handler: Parameters<typeof createServer>[1]) {
    server = createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    return { port, testHost: { hostname: "fotky-test.example", address: "127.0.0.1", port } };
  }

  it("načte og značky přes https:// adresu, pošle vlastní User-Agent a žádné cookies", async () => {
    let seen: { ua?: string; cookie?: string; auth?: string; host?: string } = {};
    const { testHost } = await start((req, res) => {
      seen = {
        ua: req.headers["user-agent"],
        cookie: req.headers.cookie,
        auth: req.headers.authorization,
        host: req.headers.host,
      };
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        `<html><head><meta property="og:title" content="Fotky &amp; videa"><meta property="og:description" content="Popis"><meta property="og:image" content="/x.jpg"></head></html>`,
      );
    });
    const result = await fetchOgCard("https://fotky-test.example/galerie", { testHost });
    expect(result).toMatchObject({
      ok: true,
      card: {
        title: "Fotky & videa",
        description: "Popis",
        imageUrl: "https://fotky-test.example/x.jpg",
      },
    });
    expect(seen.ua).toContain("se-vezmou.cz");
    expect(seen.cookie).toBeUndefined();
    expect(seen.auth).toBeUndefined();
    expect(seen.host).toBe("fotky-test.example");
  });

  it("přesměrování z výjimečného cíle na loopback nebo na http se odmítne", async () => {
    for (const location of [
      "https://127.0.0.1/tajne",
      "http://fotky-test.example/a",
      "https://fotky-test.example:9999/a",
    ]) {
      const { testHost } = await start((req, res) => {
        res.statusCode = 302;
        res.setHeader("location", location);
        res.end();
      });
      const result = await fetchOgCard("https://fotky-test.example/a", { testHost });
      expect(result).toMatchObject({ ok: false, reason: "blocked" });
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it("bez výjimky se jméno překládané na loopback odmítne", async () => {
    const { testHost } = await start((req, res) => res.end("<html></html>"));
    void testHost;
    const result = await fetchOgCard("https://fotky-test.example/a", {
      testHost: null,
      resolve: async () => ["127.0.0.1"],
    });
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
  });

  it("server, který nic neposílá, skončí časovým limitem", async () => {
    const { testHost } = await start(() => {
      /* nikdy neodpoví */
    });
    const result = await fetchOgCard("https://fotky-test.example/a", { testHost, timeoutMs: 200 });
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
  });
});
