import { createServer, type Server } from "node:http";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { PORT } from "../hosts";

/**
 * Falešný cílový server pro karty externí galerie (M7a): stránky s Open Graph značkami, bez nich,
 * s přesměrováním na loopback a s jiným typem obsahu. Aplikace se k němu připojuje jen díky
 * výjimce `OG_FETCH_TEST_HOST` (jméno `fotky-test.example` se bez DNS a bez TLS spojí s loopbackem);
 * adresa v testech je přesto `https://fotky-test.example/...`, takže platí všechna ostatní pravidla.
 * Počet požadavků (`/__hits`) dokazuje, že web hostům nikdy nevolá cizí stránku.
 */

export const OG_HOST = "fotky-test.example";
export const OG_PORT = Number(process.env.E2E_OG_PORT ?? PORT + 500);
export const OG_BASE = `https://${OG_HOST}`;

/** Obrázky cílové stránky (M7c): vytvoří se při startu serveru, aby šly podávat synchronně. */
const images: { cover?: Buffer; bomb?: Buffer; big?: Buffer } = {};

async function buildImages(): Promise<void> {
  images.cover = await sharp({
    create: { width: 1200, height: 630, channels: 3, background: { r: 30, g: 90, b: 60 } },
  })
    .jpeg()
    .toBuffer();
  // PNG s hlavičkou 20 000 x 20 000 px (400 MP) a téměř prázdnými daty: server ho musí odmítnout
  const tiny = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } })
    .png()
    .toBuffer();
  const bomb = Buffer.from(tiny);
  bomb.writeUInt32BE(20000, 16);
  bomb.writeUInt32BE(20000, 20);
  bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)) >>> 0, 29);
  images.bomb = bomb;
  // nad limit velikosti obrázku karty (5 MB)
  images.big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(6 * 1024 * 1024)]);
}

export const OG_PAGES = {
  /** Stránka s og:title, og:description a og:image. */
  galerie: { title: "Galerie Anny", description: "Fotky ze svatby Kláry a Matěje" },
} as const;

/** Obrázek karty nese stejný jedinečný dotaz `?t=...` jako stránka, takže jeho počet stažení je měřitelný po testech. */
function coverQuery(search: string): string {
  const t = new URLSearchParams(search).get("t");
  return t ? `?t=${encodeURIComponent(t)}` : "";
}

/** Počet požadavků podle cesty s dotazem (testy používají jedinečný dotaz `?t=...`, takže se nepřetahují). */
const hits = new Map<string, number>();

function page(
  path: string,
  search = "",
): {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
} {
  const html = (body: string) => ({
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body,
  });
  switch (path) {
    case "/galerie":
      return html(`<!doctype html><html><head><meta charset="utf-8">
        <title>Nepoužije se</title>
        <meta property="og:title" content="${OG_PAGES.galerie.title}">
        <meta property="og:description" content="${OG_PAGES.galerie.description} &amp; videa">
        <meta property="og:image" content="/cover.jpg${coverQuery(search)}"></head><body><h1>Galerie</h1></body></html>`);
    case "/cover.jpg":
      return { status: 200, headers: { "content-type": "image/jpeg" }, body: images.cover! };
    case "/galerie-svg":
    case "/galerie-bomba":
    case "/galerie-velky":
    case "/galerie-lzi":
    case "/galerie-presmerovani": {
      const image = {
        "/galerie-svg": "/evil.svg",
        "/galerie-bomba": "/bomba.png",
        "/galerie-velky": "/velky.jpg",
        "/galerie-lzi": "/lzi.jpg",
        "/galerie-presmerovani": "/img-redirect",
      }[path];
      return html(`<!doctype html><html><head><meta charset="utf-8">
        <meta property="og:title" content="Galerie bez obrázku (${path.replace("/galerie-", "")})">
        <meta property="og:image" content="${image}"></head><body></body></html>`);
    }
    case "/evil.svg":
      return {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
        body: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
      };
    case "/bomba.png":
      return { status: 200, headers: { "content-type": "image/png" }, body: images.bomb! };
    case "/velky.jpg":
      return { status: 200, headers: { "content-type": "image/jpeg" }, body: images.big! };
    case "/lzi.jpg":
      return {
        status: 200,
        headers: { "content-type": "image/jpeg" },
        body: "<html><script>alert(1)</script></html>",
      };
    case "/img-redirect":
      return { status: 302, headers: { location: "https://127.0.0.1/tajny.jpg" }, body: "" };
    case "/zneuzivani":
      return html(`<!doctype html><html><head>
        <meta property="og:title" content="&lt;img src=x onerror=alert(1)&gt;">
        <meta property="og:description" content="&lt;script&gt;alert(1)&lt;/script&gt;"></head><body></body></html>`);
    case "/bez-og":
      return html("<!doctype html><html><head><title></title></head><body>Nic</body></html>");
    case "/pdf":
      return { status: 200, headers: { "content-type": "application/pdf" }, body: "%PDF-1.4" };
    case "/presmerovani":
      return { status: 302, headers: { location: "https://127.0.0.1/tajne" }, body: "" };
    case "/presmerovani-http":
      return { status: 302, headers: { location: `http://${OG_HOST}/galerie` }, body: "" };
    case "/chraneno":
      return { status: 403, headers: { "content-type": "text/html" }, body: "<html></html>" };
    default:
      return { status: 404, headers: { "content-type": "text/html" }, body: "<html></html>" };
  }
}

export async function startOgServer(): Promise<() => Promise<void>> {
  await buildImages();
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const full = new URL(req.url ?? "/", "http://localhost");
    if (path === "/__hits") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ hits: hits.get(full.searchParams.get("path") ?? "") ?? 0 }));
      return;
    }
    const key = `${full.pathname}${full.search}`;
    hits.set(key, (hits.get(key) ?? 0) + 1);
    const reply = page(path, full.search);
    res.statusCode = reply.status;
    for (const [key, value] of Object.entries(reply.headers)) res.setHeader(key, value);
    res.end(reply.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(OG_PORT, "127.0.0.1", resolve);
  });
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}

/** Počet požadavků na danou cestu s dotazem (čte se přes HTTP, protože server běží v hlavním procesu). */
export async function ogHits(pathWithQuery: string): Promise<number> {
  const response = await fetch(
    `http://127.0.0.1:${OG_PORT}/__hits?path=${encodeURIComponent(pathWithQuery)}`,
  );
  return ((await response.json()) as { hits: number }).hits;
}
