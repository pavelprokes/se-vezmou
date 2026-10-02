import { createServer, type Server } from "node:http";
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

export const OG_PAGES = {
  /** Stránka s og:title, og:description a og:image. */
  galerie: { title: "Galerie Anny", description: "Fotky ze svatby Kláry a Matěje" },
} as const;

/** Počet požadavků podle cesty s dotazem (testy používají jedinečný dotaz `?t=...`, takže se nepřetahují). */
const hits = new Map<string, number>();

function page(path: string): { status: number; headers: Record<string, string>; body: string } {
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
        <meta property="og:image" content="/cover.jpg"></head><body><h1>Galerie</h1></body></html>`);
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
    const reply = page(path);
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
