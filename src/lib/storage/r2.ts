import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";
import {
  StorageError,
  StorageTooLargeError,
  assertKey,
  incomingKey,
  incomingPrefix,
  mediaPrefix,
  parseKey,
  weddingPrefix,
  type PhotoStorage,
  type PutTarget,
  type StoredObject,
} from "./types";

/**
 * Úložiště fotografií na Cloudflare R2 přes S3 API (docs/adr/0006-photo-storage.md). Bez SDK: podepisuje
 * `aws4fetch` (malá knihovna nad `fetch` a Web Crypto), takže funguje beze změny na Vercelu i v testech.
 * Bucket je privátní a nemá veřejnou adresu; přístup jen přes serverové přihlašovací údaje a podepsané adresy.
 * Používá se adresování cestou (`{endpoint}/{bucket}/{klíč}`), které R2 podporuje.
 *
 * Chybové zprávy neobsahují adresu s podpisem ani klíče objektů (do logu by prozradily tajné hodnoty).
 */

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** `https://<account-id>.eu.r2.cloudflarestorage.com` (jurisdikce EU) nebo výchozí `…r2.cloudflarestorage.com`. */
  endpoint: string;
  region: string;
};

export type R2ConfigResult =
  { status: "ok"; config: R2Config } | { status: "missing"; missing: string[]; anySet: boolean };

const REQUIRED = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

/**
 * Nastavení R2 z proměnných prostředí. `R2_ENDPOINT` se bez zadání odvodí z účtu (jurisdikce EU, jako v ADR);
 * `S3_REGION` je výchozí `auto`. Chybějící povinná proměnná je výsledek `missing` (ne výjimka): volající ho
 * použije k jasné chybě, až když se fotografie opravdu používají.
 */
export function r2ConfigFromEnv(env: Record<string, string | undefined>): R2ConfigResult {
  const value = (key: string) => env[key]?.trim() || undefined;
  const missing = REQUIRED.filter((key) => !value(key));
  const anySet = [...REQUIRED, "R2_ENDPOINT"].some((key) => Boolean(value(key)));
  if (missing.length > 0) return { status: "missing", missing: [...missing], anySet };
  const accountId = value("R2_ACCOUNT_ID")!;
  const endpoint = (
    value("R2_ENDPOINT") ?? `https://${accountId}.eu.r2.cloudflarestorage.com`
  ).replace(/\/+$/, "");
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:") throw new Error("not https");
  } catch {
    return { status: "missing", missing: ["R2_ENDPOINT (platná adresa https)"], anySet: true };
  }
  return {
    status: "ok",
    config: {
      accountId,
      accessKeyId: value("R2_ACCESS_KEY_ID")!,
      secretAccessKey: value("R2_SECRET_ACCESS_KEY")!,
      bucket: value("R2_BUCKET")!,
      endpoint,
      region: value("S3_REGION") ?? "auto",
    },
  };
}

/** Původ úložiště (pro Content-Security-Policy: `connect-src` a `img-src`), nebo `null`. */
export function r2OriginFromEnv(env: Record<string, string | undefined>): string | null {
  const result = r2ConfigFromEnv(env);
  return result.status === "ok" ? new URL(result.config.endpoint).origin : null;
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Stránka výpisu `ListObjectsV2` (jen pole, která potřebujeme). */
export function parseListPage(xml: string): {
  objects: StoredObject[];
  truncated: boolean;
  next: string | null;
} {
  const objects: StoredObject[] = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(match[1])?.[1];
    const size = /<Size>(\d+)<\/Size>/.exec(match[1])?.[1];
    if (key !== undefined) objects.push({ key: xmlUnescape(key), bytes: Number(size ?? 0) });
  }
  const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
  return {
    objects,
    truncated: /<IsTruncated>true<\/IsTruncated>/.test(xml),
    next: next ? xmlUnescape(next) : null,
  };
}

/** Klíče, které `DeleteObjects` nesmazal (`<Error><Key>…`). */
export function parseDeleteErrors(xml: string): string[] {
  return [...xml.matchAll(/<Error>([\s\S]*?)<\/Error>/g)].map((match) =>
    xmlUnescape(/<Key>([\s\S]*?)<\/Key>/.exec(match[1])?.[1] ?? ""),
  );
}

/** Časový limit jednoho požadavku na R2. */
export const REQUEST_TIMEOUT_MS = 10_000;
const RETRIES = 2;
const RETRY_MS = 50;

const DELETE_BATCH = 1000;
const LIST_PAGE = 1000;
/** Pojistka proti nekonečnému stránkování (1000 stránek po 1000 klíčích je řádově víc, než svatba unese). */
const MAX_PAGES = 1000;

export function createR2Storage(config: R2Config): PhotoStorage {
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region,
  });
  const bucketUrl = `${config.endpoint}/${config.bucket}`;
  const objectUrl = (key: string) => `${bucketUrl}/${encodeKey(key)}`;

  async function request(
    url: string,
    init: RequestInit & { aws?: Record<string, unknown> },
    what: string,
  ): Promise<Response> {
    // `aws4fetch` jen podepisuje; `fetch` dostane adresu a tělo v `init`, ne hotový `Request`. Next.js v serverových
    // akcích `fetch` obaluje a `Request` znovu sestaví s tělem jako streamem: PUT pak odejde bez `content-length`
    // a R2 ho odmítne (411 Length Required).
    // Jeden časový limit na celé volání včetně opakování (i čtení těla odpovědi), ať visící R2 nezdrží funkci na Vercelu.
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        const signed = await aws.sign(url, init);
        response = await fetch(signed.url, {
          method: signed.method,
          headers: signed.headers,
          body: init.body,
          cache: "no-store",
          signal,
        });
      } catch {
        throw new StorageError("storage_failed", `Úložiště nedostupné (${what})`);
      }
      // Opakování při 5xx a 429 (R2 občas vrací krátkodobé chyby); víc pokusů by protáhlo funkci na Vercelu.
      const retryable = response.status >= 500 || response.status === 429;
      if (!retryable || attempt >= RETRIES) return response;
      await response.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS * 2 ** attempt));
    }
  }

  function failed(what: string, response: Response): StorageError {
    return new StorageError(
      "storage_failed",
      `Úložiště odmítlo požadavek (${what}, ${response.status})`,
    );
  }

  async function listKeys(prefix: string): Promise<StoredObject[]> {
    const all: StoredObject[] = [];
    let token: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(bucketUrl);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", prefix);
      url.searchParams.set("max-keys", String(LIST_PAGE));
      if (token) url.searchParams.set("continuation-token", token);
      const response = await request(url.toString(), { method: "GET" }, "výpis");
      if (!response.ok) throw failed("výpis", response);
      const parsed = parseListPage(await response.text());
      // Pojistka: nikdy nezpracujeme klíč mimo žádanou předponu.
      for (const object of parsed.objects) if (object.key.startsWith(prefix)) all.push(object);
      if (!parsed.truncated || !parsed.next) return all;
      token = parsed.next;
    }
    throw new StorageError("storage_failed", "Výpis úložiště je nezvykle dlouhý");
  }

  async function deleteBatch(keys: string[]): Promise<void> {
    const body =
      `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>` +
      keys.map((key) => `<Object><Key>${xmlEscape(key)}</Key></Object>`).join("") +
      `</Delete>`;
    const md5 = createHash("md5").update(body, "utf8").digest("base64");
    const response = await request(
      `${bucketUrl}?delete`,
      {
        method: "POST",
        body,
        headers: { "content-type": "application/xml", "content-md5": md5 },
      },
      "mazání",
    );
    if (!response.ok) throw failed("mazání", response);
    const errors = parseDeleteErrors(await response.text());
    if (errors.length > 0) {
      throw new StorageError("storage_failed", `Úložiště nesmazalo ${errors.length} souborů`);
    }
  }

  async function deleteAll(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += DELETE_BATCH) {
      await deleteBatch(keys.slice(i, i + DELETE_BATCH));
    }
  }

  async function presign(
    key: string,
    method: "GET" | "PUT",
    options: {
      expiresInSeconds: number;
      datetime?: string;
      query?: Record<string, string>;
      /** Hlavičky, které se podepíšou (klient je musí poslat beze změny); např. `content-length`. */
      signedHeaders?: Record<string, string>;
    },
  ): Promise<string> {
    assertKey(key);
    const url = new URL(objectUrl(key));
    for (const [name, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(name, value);
    }
    url.searchParams.set("X-Amz-Expires", String(options.expiresInSeconds));
    const signed = await aws.sign(url.toString(), {
      method,
      headers: options.signedHeaders,
      aws: {
        signQuery: true,
        // `allHeaders`: aws4fetch jinak `content-length` z podpisu vynechává
        ...(options.signedHeaders ? { allHeaders: true } : {}),
        ...(options.datetime ? { datetime: options.datetime } : {}),
      },
    });
    return signed.url;
  }

  return {
    kind: "r2",

    async listPrefix(weddingId) {
      return listKeys(weddingPrefix(weddingId));
    },

    async deletePrefix(weddingId) {
      const keys = [
        ...(await listKeys(weddingPrefix(weddingId))),
        ...(await listKeys(incomingPrefix(weddingId))),
      ].map((object) => object.key);
      await deleteAll(keys);
      return { deleted: keys.length };
    },

    async presignPut(key, options): Promise<PutTarget> {
      if (!parseKey(key)?.incoming) {
        throw new StorageError("invalid_key", "Nahrávat lze jen do karantény");
      }
      if (!Number.isSafeInteger(options.bytes) || options.bytes < 1) {
        throw new StorageError("invalid_key", "Chybná velikost nahrávaného souboru");
      }
      // Podepsaná je přesná délka těla (`content-length`): R2 odmítne PUT s jiným počtem bajtů, takže nahrávání
      // nejde použít k uložení většího souboru, než jaký schválil server. Prohlížeč délku posílá sám.
      const url = await presign(key, "PUT", {
        expiresInSeconds: options.expiresInSeconds,
        signedHeaders: { "content-length": String(options.bytes) },
      });
      return {
        url,
        method: "PUT",
        headers: { "Content-Type": options.contentType },
        expiresInSeconds: options.expiresInSeconds,
      };
    },

    async presignGet(key, options) {
      const window = Math.max(60, Math.floor(options.windowSeconds));
      const now = options.now ?? new Date();
      // Podpis se váže na začátek časového okna a platí dvě okna: adresa je po dobu okna beze změny
      // (prohlížeč ji cachuje) a po nejvýš dvou oknech vyprší.
      const start = new Date(Math.floor(now.getTime() / 1000 / window) * window * 1000);
      return presign(key, "GET", {
        expiresInSeconds: window * 2,
        datetime: amzDate(start),
        query: options.downloadName
          ? {
              "response-content-disposition": `attachment; filename="${options.downloadName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
            }
          : undefined,
      });
    },

    async headObject(key) {
      assertKey(key);
      const response = await request(objectUrl(key), { method: "HEAD" }, "head");
      if (response.status === 404) return null;
      if (!response.ok) throw failed("head", response);
      return { bytes: Number(response.headers.get("content-length") ?? 0) };
    },

    async getObject(key, options) {
      assertKey(key);
      const response = await request(objectUrl(key), { method: "GET" }, "čtení");
      if (response.status === 404) return null;
      if (!response.ok) throw failed("čtení", response);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > options.maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new StorageTooLargeError();
      }
      if (!response.body) return Buffer.alloc(0);
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > options.maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new StorageTooLargeError();
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    },

    async putObject(key, body, options) {
      assertKey(key);
      const response = await request(
        objectUrl(key),
        {
          method: "PUT",
          body: new Uint8Array(body),
          headers: {
            "content-type": options.contentType,
            ...(options.cacheControl ? { "cache-control": options.cacheControl } : {}),
          },
        },
        "zápis",
      );
      if (!response.ok) throw failed("zápis", response);
      await response.body?.cancel().catch(() => undefined);
    },

    async deleteObjects(keys) {
      for (const key of keys) assertKey(key);
      await deleteAll(keys);
    },

    async deleteMedia(weddingId, mediaId) {
      const variants = (await listKeys(mediaPrefix(weddingId, mediaId))).map((o) => o.key);
      const original = incomingKey(weddingId, mediaId);
      await deleteAll([original, ...variants]);
    },
  };
}
