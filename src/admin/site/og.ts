import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { galleryCardSchema, httpsUrl, type GalleryCard } from "@/site/types";

/**
 * Karta odkazu na externí galerii z Open Graph cílové stránky (FR-WEB-5). Stahuje SERVER, jen při
 * uložení nebo změně odkazu a na tlačítko „Obnovit náhled“, nikdy při zobrazení webu hostovi.
 * Cílová adresa je zadaná uživatelem, takže jde o klasické riziko SSRF; obrana:
 *  - jen `https` na portu 443, bez přihlašovacích údajů v adrese, bez IP adres a bez `localhost`,
 *  - překlad jména provádíme sami a odmítneme CELÉ jméno, pokud některá adresa je soukromá,
 *    loopback, link-local, sdílená, dokumentační nebo vícesměrová; spojení jde přímo na
 *    ověřenou adresu (žádný druhý překlad, takže DNS rebinding nepomůže), TLS se ověřuje
 *    proti jménu hostitele,
 *  - totéž platí po KAŽDÉM přesměrování (nejvýše 3),
 *  - časový limit 5 s na vše, odpověď nejvýše 512 kB, jen `text/html`, bez komprese,
 *  - parsuje se jen začátek dokumentu (`<head>`), nic se nespouští, žádné cookies, vlastní User-Agent,
 *  - všechny hodnoty jsou nedůvěryhodný text: zkracují se, zbavují řídicích znaků a při zobrazení
 *    se vypisují jako text (React escapuje); adresa obrázku se jen ukládá, web ji nevykresluje.
 * Jediná výjimka je jedno jméno hostitele z `OG_FETCH_TEST_HOST` (`jmeno=127.0.0.1:port`, e2e testy
 * proti lokálnímu falešnému cíli): jméno se bez DNS spojí s loopbackem bez TLS, adresa zůstává
 * `https://jmeno/...`, takže ostatní kontroly (tvar adresy, přesměrování) platí beze změny.
 * Cíl výjimky smí být jen loopback; v produkci se proměnná nenastavuje.
 */

export const OG_LIMITS = {
  timeoutMs: 5000,
  maxBytes: 512 * 1024,
  maxRedirects: 3,
  title: 200,
  description: 400,
} as const;

export const OG_USER_AGENT = "se-vezmou.cz-linkpreview/1.0 (+https://se-vezmou.cz)";

export type OgFailure =
  | "invalid_url"
  | "blocked"
  | "unreachable"
  | "timeout"
  | "too_large"
  | "not_html"
  | "redirects"
  | "status"
  | "no_tags"
  | "not_image";

export type OgResult =
  { ok: true; card: GalleryCard } | { ok: false; reason: OgFailure; card: GalleryCard };

// --- adresy ----------------------------------------------------------------------------------

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? parts
    : null;
}

function publicIpv4(address: string): boolean {
  const p = ipv4Parts(address);
  if (!p) return false;
  const [a, b, c] = p;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // sdílený rozsah operátorů
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false; // vícesměrové a vyhrazené
  return true;
}

/** Rozbalí IPv6 zápis na osm 16bitových skupin; neplatný zápis je `null`. */
function ipv6Groups(address: string): number[] | null {
  let value = address.toLowerCase();
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);
  // vložený IPv4 zápis na konci (::ffff:1.2.3.4)
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (tail) {
    const v4 = ipv4Parts(tail[1]);
    if (!v4) return null;
    value = `${value.slice(0, -tail[1].length)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const rest = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];
  const missing = 8 - head.length - rest.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function publicIpv6(address: string): boolean {
  const g = ipv6Groups(address);
  if (!g) return false;
  const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
    return publicIpv4(embedded(g[6], g[7]));
  if (g.slice(0, 6).every((x) => x === 0)) return false; // ::, ::1 a IPv4 kompatibilní tvar
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return publicIpv4(embedded(g[6], g[7])); // NAT64
  }
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 (unique local)
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 (link-local)
  if ((g[0] & 0xff00) === 0xff00) return false; // ff00::/8 (vícesměrové)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // dokumentační
  if (g[0] === 0x2002) return publicIpv4(embedded(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  return true;
}

/** Veřejně směrovatelná adresa (jediná, na kterou se smí spojit). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return publicIpv4(address);
  if (family === 6) return publicIpv6(address);
  return false;
}

/** Adresa je podle tvaru přípustná: https, port 443, bez přihlášení, jméno (ne IP adresa) s tečkou. */
export function isAllowedTarget(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  if (url.port !== "" && url.port !== "443") return false;
  if (url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase();
  if (host === "" || isIP(host) !== 0 || host.startsWith("[")) return false;
  if (!host.includes(".") || host.endsWith(".") || host.endsWith(".localhost")) return false;
  if (/\.(local|internal|lan|home|corp|intranet)$/.test(host)) return false;
  return true;
}

// --- doprava (vyměnitelná kvůli testům) ----------------------------------------------------------

export interface PageRequest {
  url: URL;
  /** Ověřená adresa, na kterou se spojení skutečně naváže. */
  address: string;
  signal: AbortSignal;
  /** Hlavička `Accept` (HTML pro kartu, obrázky pro náhledový obrázek); bez ní HTML. */
  accept?: string;
  /** Jen e2e (`OG_FETCH_TEST_HOST`): spojení bez TLS na tento port loopbacku. */
  plainPort?: number;
}

/** Výjimečný cíl e2e testů: jméno hostitele, které se spojí s loopbackem bez DNS a bez TLS. */
export interface TestHost {
  hostname: string;
  address: string;
  port: number;
}

export interface PageResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
}

export interface OgDeps {
  resolve(hostname: string): Promise<string[]>;
  request(request: PageRequest): Promise<PageResponse>;
  now(): Date;
  /** Jediný povolený výjimečný cíl (jen e2e testy). */
  testHost: TestHost | null;
  timeoutMs: number;
}

const defaultDeps: OgDeps = {
  async resolve(hostname) {
    const records = await dnsLookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  },
  request({ url, address, signal, plainPort, accept }) {
    return new Promise<PageResponse>((resolve, reject) => {
      const secure = plainPort === undefined && url.protocol === "https:";
      const req = (secure ? httpsRequest : httpRequest)(
        {
          host: address,
          port: plainPort ?? (url.port !== "" ? Number(url.port) : 443),
          path: `${url.pathname}${url.search}`,
          method: "GET",
          // Spojení jde na ověřenou adresu; jméno hostitele nese Host a SNI (TLS se ověřuje proti němu).
          servername: secure ? url.hostname : undefined,
          headers: {
            host: url.host,
            "user-agent": OG_USER_AGENT,
            accept: accept ?? "text/html,application/xhtml+xml;q=0.9",
            "accept-encoding": "identity",
            "accept-language": "cs,en;q=0.8",
          },
          signal,
          agent: false,
        },
        (res) => {
          const headers: Record<string, string | undefined> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            headers[key] = Array.isArray(value) ? value.join(", ") : value;
          }
          resolve({
            status: res.statusCode ?? 0,
            headers,
            body: res,
            destroy: () => res.destroy(),
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  },
  now: () => new Date(),
  testHost: null,
  timeoutMs: OG_LIMITS.timeoutMs,
};

/** `jmeno.example=127.0.0.1:4555`; cíl jiný než loopback se ignoruje (výjimka nikdy nepovolí cizí síť). */
export function parseTestHost(value: string | undefined): TestHost | null {
  const match = /^([a-z0-9.-]+\.[a-z]{2,})=(127\.0\.0\.1):(\d{2,5})$/i.exec(value?.trim() ?? "");
  return match
    ? { hostname: match[1].toLowerCase(), address: match[2], port: Number(match[3]) }
    : null;
}

function envDeps(): OgDeps {
  return { ...defaultDeps, testHost: parseTestHost(process.env.OG_FETCH_TEST_HOST) };
}

// --- zpracování HTML ----------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Nedůvěryhodný text: bez řídicích a směrových znaků, s jednou mezerou, zkrácený. */
export function cleanOgText(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const text = decodeEntities(value)
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function metaTags(head: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
    }
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    const content = attrs.get("content");
    if (key && content !== undefined && !found.has(key)) found.set(key, content);
  }
  return found;
}

/** Karta z začátku HTML dokumentu (`<head>`); `null`, když nenese nic použitelného. */
export function parseOgCard(html: string, pageUrl: URL, now: Date): GalleryCard | null {
  const end = html.search(/<\/head\s*>/i);
  const head = end >= 0 ? html.slice(0, end) : html.slice(0, OG_LIMITS.maxBytes);
  const meta = metaTags(head);
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1];

  const title = cleanOgText(
    meta.get("og:title") ?? meta.get("twitter:title") ?? titleTag,
    OG_LIMITS.title,
  );
  const description = cleanOgText(
    meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description"),
    OG_LIMITS.description,
  );
  let imageUrl: string | null = null;
  const image = meta.get("og:image") ?? meta.get("og:image:url") ?? meta.get("twitter:image");
  if (image) {
    try {
      const resolved = new URL(decodeEntities(image).trim(), pageUrl);
      const parsed = httpsUrl.safeParse(resolved.toString());
      if (parsed.success && resolved.username === "" && resolved.password === "") {
        imageUrl = parsed.data;
      }
    } catch {
      imageUrl = null;
    }
  }
  if (!title && !description && !imageUrl) return null;
  return galleryCardSchema.parse({
    title,
    description,
    imageUrl,
    fetchedAt: now.toISOString(),
    status: "ok",
  });
}

// --- načtení ----------------------------------------------------------------------------------

function failure(reason: OgFailure, now: Date): OgResult {
  return {
    ok: false,
    reason,
    card: galleryCardSchema.parse({
      title: null,
      description: null,
      imageUrl: null,
      fetchedAt: now.toISOString(),
      status: "failed",
    }),
  };
}

class Stop extends Error {
  constructor(readonly reason: OgFailure) {
    super(reason);
  }
}

async function readHead(response: PageResponse): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > OG_LIMITS.maxBytes) {
        // Hlavička často skončí dřív; co máme, stačí k rozboru. Příliš dlouhý dokument bez
        // `</head>` v limitu je nepoužitelný.
        chunks.push(buffer.subarray(0, buffer.length - (size - OG_LIMITS.maxBytes)));
        const partial = Buffer.concat(chunks).toString("utf8");
        if (!/<\/head\s*>/i.test(partial)) throw new Stop("too_large");
        break;
      }
      chunks.push(buffer);
      // Dál než za konec <head> číst netřeba (a nemá smysl).
      if (/<\/head\s*>/i.test(Buffer.concat(chunks).toString("utf8"))) break;
    }
  } finally {
    response.destroy();
  }
  return Buffer.concat(chunks).toString("utf8");
}

type Opened = { ok: true; response: PageResponse; url: URL } | { ok: false; reason: OgFailure };

/**
 * Společná, SSRF-bezpečná část načtení cizí adresy (karta i obrázek): kontrola tvaru adresy, vlastní překlad
 * jména s odmítnutím celého jména při jediné neveřejné adrese, spojení na ověřenou adresu a totéž po každém
 * přesměrování (nejvýše 3). Vrací odpověď se stavem 2xx; typ a velikost obsahu kontroluje volající.
 * Výjimky (chyba sítě, DNS) vyhazuje, volající je převede na selhání.
 */
async function openGuarded(
  rawUrl: string,
  deps: OgDeps,
  signal: AbortSignal,
  accept: string,
): Promise<Opened> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  for (let hop = 0; hop <= OG_LIMITS.maxRedirects; hop++) {
    if (!isAllowedTarget(url)) {
      return { ok: false, reason: hop === 0 ? "invalid_url" : "blocked" };
    }

    let address: string;
    const viaTest = deps.testHost !== null && url.hostname === deps.testHost.hostname;
    if (viaTest) {
      address = deps.testHost!.address;
    } else {
      const addresses = await deps.resolve(url.hostname);
      if (addresses.length === 0) return { ok: false, reason: "unreachable" };
      // Jedna soukromá adresa znehodnotí celé jméno (útočník řídí, co DNS vrátí).
      if (!addresses.every(isPublicAddress)) return { ok: false, reason: "blocked" };
      address = addresses[0];
    }

    const response = await deps.request({
      url,
      address,
      signal,
      accept,
      plainPort: viaTest ? deps.testHost!.port : undefined,
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      response.destroy();
      const location = response.headers.location;
      if (!location) return { ok: false, reason: "status" };
      if (hop === OG_LIMITS.maxRedirects) return { ok: false, reason: "redirects" };
      try {
        url = new URL(location, url);
      } catch {
        return { ok: false, reason: "invalid_url" };
      }
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      response.destroy();
      return { ok: false, reason: "status" };
    }
    return { ok: true, response, url };
  }
  return { ok: false, reason: "redirects" };
}

/**
 * Načte metadata stránky. Nikdy nevyhodí: neúspěch je výsledek s důvodem (`reason`) a kartou ve
 * stavu `failed`, takže uložení odkazu nic neblokuje a web spadne na doménu a text odkazu.
 */
export async function fetchOgCard(
  rawUrl: string,
  overrides: Partial<OgDeps> = {},
): Promise<OgResult> {
  const deps: OgDeps = { ...envDeps(), ...overrides };
  const now = deps.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);

  try {
    const opened = await openGuarded(
      rawUrl,
      deps,
      controller.signal,
      "text/html,application/xhtml+xml;q=0.9",
    );
    if (!opened.ok) return failure(opened.reason, now);
    const { response, url } = opened;

    const type = (response.headers["content-type"] ?? "").toLowerCase();
    if (!/^(text\/html|application\/xhtml\+xml)\b/.test(type)) {
      response.destroy();
      return failure("not_html", now);
    }
    const encoding = (response.headers["content-encoding"] ?? "identity").toLowerCase();
    if (encoding !== "identity") {
      response.destroy();
      return failure("not_html", now);
    }
    const length = Number(response.headers["content-length"] ?? 0);
    if (Number.isFinite(length) && length > OG_LIMITS.maxBytes * 4) {
      response.destroy();
      return failure("too_large", now);
    }

    const html = await readHead(response);
    const card = parseOgCard(html, url, now);
    return card ? { ok: true, card } : failure("no_tags", now);
  } catch (error) {
    if (error instanceof Stop) return failure(error.reason, now);
    if (controller.signal.aborted) return failure("timeout", now);
    return failure("unreachable", now);
  } finally {
    clearTimeout(timer);
  }
}

// --- obrázek karty -------------------------------------------------------------------------------

export const OG_IMAGE_LIMITS = {
  /** Největší stažený obrázek (po něm už se nečte). */
  maxBytes: 5 * 1024 * 1024,
  timeoutMs: 10_000,
} as const;

export type OgImageResult =
  { ok: true; data: Buffer; contentType: string } | { ok: false; reason: OgFailure };

/**
 * Stáhne náhledový obrázek cílové stránky (`og:image`) SERVEREM, s týmiž zárukami proti SSRF jako karta
 * (`openGuarded`): jen https na portu 443, žádné soukromé adresy ani po přesměrování, časový limit. Navíc jen
 * typ JPEG, PNG nebo WebP (SVG ani nic jiného), bez komprese a se stropem velikosti. Obsah se tu jen načte;
 * skutečný typ a rozměry ověří a obrázek překóduje `processImage` (nikdy se nepodává dál tak, jak přišel).
 * Nikdy nevyhodí.
 */
export async function fetchOgImage(
  rawUrl: string,
  overrides: Partial<OgDeps> = {},
): Promise<OgImageResult> {
  const deps: OgDeps = { ...envDeps(), timeoutMs: OG_IMAGE_LIMITS.timeoutMs, ...overrides };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const opened = await openGuarded(
      rawUrl,
      deps,
      controller.signal,
      "image/jpeg,image/png,image/webp;q=0.9",
    );
    if (!opened.ok) return { ok: false, reason: opened.reason };
    const { response } = opened;

    const type = (response.headers["content-type"] ?? "").toLowerCase().split(";")[0].trim();
    const encoding = (response.headers["content-encoding"] ?? "identity").toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(type) || encoding !== "identity") {
      response.destroy();
      return { ok: false, reason: "not_image" };
    }
    const length = Number(response.headers["content-length"] ?? 0);
    if (Number.isFinite(length) && length > OG_IMAGE_LIMITS.maxBytes) {
      response.destroy();
      return { ok: false, reason: "too_large" };
    }

    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > OG_IMAGE_LIMITS.maxBytes) return { ok: false, reason: "too_large" };
        chunks.push(buffer);
      }
    } finally {
      response.destroy();
    }
    if (size === 0) return { ok: false, reason: "not_image" };
    return { ok: true, data: Buffer.concat(chunks), contentType: type };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
