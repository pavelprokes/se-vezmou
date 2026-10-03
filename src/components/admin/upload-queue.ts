import type { MediaActions } from "@/lib/media/action-types";
import { MEDIA_LIMITS, isAcceptedMime } from "@/lib/media/limits";
import type { FailureCode, MediaItem } from "@/lib/media/types";

/**
 * Fronta nahrávání fotografií v prohlížeči (docs/adr/0006-photo-storage.md, kroky 1 až 3; převzato z `g-gallery`
 * v upravené podobě). Soubory se zpracovávají PO JEDNOM (jedna funkce na serveru nezpracovává celou sadu):
 *  1. kontrola typu a velikosti v prohlížeči (HEIC se odmítne srozumitelně, ne až serverem),
 *  2. volitelné zmenšení nejdelší strany na 4 000 px (rychlejší nahrávání z mobilní sítě); když selže
 *     (paměť telefonu, neznámý formát), nahraje se PŮVODNÍ soubor,
 *  3. žádost o podepsanou adresu (server ověří relaci, svatbu, kvótu a omezení počtu požadavků),
 *  4. PUT přímo do úložiště s průběhem a opakováním (krátké čekání a nový pokus; po vypršení adresy se vyžádá nová
 *     pro tutéž fotografii),
 *  5. „dokončit“: server zpracuje originál (typ podle obsahu, pixely, EXIF pryč, varianty).
 * Chyba jedné fotografie ostatní nezastaví; selhanou jde zopakovat. Třída je bez Reactu, aby šla testovat.
 */

export type QueueStatus = "queued" | "preparing" | "uploading" | "processing" | "done" | "error";

export type QueueError =
  | "type"
  | "heic"
  | "too_large"
  | "quota"
  | "network"
  | "limited"
  | "unavailable"
  | "closed"
  | "busy"
  | FailureCode;

export interface QueueEntry {
  key: string;
  name: string;
  size: number;
  status: QueueStatus;
  /** Průběh nahrávání 0 až 100. */
  progress: number;
  error?: QueueError;
  /** Fotografie je v databázi (po žádosti o nahrání); opakování pak jen obnoví adresu. */
  mediaId?: string;
  attempt: number;
}

/**
 * Chyby, které zopakování nespraví (typ souboru, rozměry, velikost, kvóta): tlačítko „Zkusit znovu“ se nenabízí,
 * soubor je potřeba vyměnit. Ostatní chyby (síť, omezení počtu požadavků, úložiště) jsou přechodné.
 */
export const FINAL_ERRORS: readonly QueueError[] = [
  "type",
  "heic",
  "unsupported_type",
  "too_many_pixels",
  "corrupt",
  "empty",
  "too_large",
  "quota",
  "closed",
];

export class PutError extends Error {
  constructor(readonly status: number) {
    super(`PUT ${status}`);
    this.name = "PutError";
  }
}

export interface QueueDeps {
  actions: Pick<MediaActions, "requestUpload" | "renewUpload" | "finishUpload">;
  /** PUT souboru na podepsanou adresu; vyhodí `PutError`. */
  put(
    target: { url: string; headers: Record<string, string> },
    blob: Blob,
    onProgress: (percent: number) => void,
  ): Promise<void>;
  /** Zmenší soubor (nebo vrátí původní). */
  prepare(file: File): Promise<Blob>;
  sleep(ms: number): Promise<void>;
  /** Kolik fotografií ještě smí přibýt (limit 12 minus ty, které už jsou). */
  slotsLeft(): number;
  onChange(entries: readonly QueueEntry[]): void;
  /** Fotografie je hotová a v databázi. */
  onDone(item: MediaItem, entry: QueueEntry): void;
  /** Srozumitelná zpráva do živé oblasti (`status` je jen kód, překlad dělá rozhraní). */
  announce?(entry: QueueEntry): void;
}

const PUT_ATTEMPTS = 3;
const BACKOFF_MS = [800, 2500];
const BUSY_ATTEMPTS = 6;

/** Typ souboru podle `File.type`, nebo podle přípony (některé prohlížeče a zařízení typ nevyplní). */
export function declaredMime(file: Pick<File, "type" | "name">): string {
  const type = file.type.toLowerCase();
  if (type) return type;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  return ext === "jpg" || ext === "jpeg"
    ? "image/jpeg"
    : ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : ext === "heic" || ext === "heif"
          ? "image/heic"
          : "";
}

/** Kontrola v prohlížeči před nahráním; `null` = v pořádku. Skutečný typ ověřuje server z obsahu. */
export function precheck(file: Pick<File, "type" | "name">): QueueError | null {
  const mime = declaredMime(file);
  if (/heic|heif/.test(mime) || /\.(heic|heif)$/i.test(file.name)) return "heic";
  return isAcceptedMime(mime) ? null : "type";
}

let counter = 0;

export class UploadQueue {
  private entries: QueueEntry[] = [];
  private files = new Map<string, File>();
  /** Připravený (zmenšený) soubor podle položky; stejný přes všechna opakování. */
  private blobs = new Map<string, Blob>();
  private running = false;
  private closed = false;

  constructor(private readonly deps: QueueDeps) {}

  snapshot(): readonly QueueEntry[] {
    return this.entries;
  }

  dispose(): void {
    this.closed = true;
  }

  private update(key: string, patch: Partial<QueueEntry>): QueueEntry | undefined {
    let changed: QueueEntry | undefined;
    this.entries = this.entries.map((entry) => {
      if (entry.key !== key) return entry;
      changed = { ...entry, ...patch };
      return changed;
    });
    if (!this.closed) this.deps.onChange(this.entries);
    return changed;
  }

  private fail(key: string, error: QueueError): void {
    const entry = this.update(key, { status: "error", error, progress: 0 });
    if (entry) this.deps.announce?.(entry);
  }

  /** Přidá soubory do fronty; co se nevejde do limitu nebo nemá povolený typ, rovnou skončí chybou. */
  add(files: readonly File[]): void {
    let slots =
      this.deps.slotsLeft() -
      this.entries.filter((e) => e.status !== "done" && e.status !== "error").length;
    for (const file of files) {
      const key = `u${++counter}`;
      const entry: QueueEntry = {
        key,
        name: file.name,
        size: file.size,
        status: "queued",
        progress: 0,
        attempt: 0,
      };
      this.entries = [...this.entries, entry];
      this.files.set(key, file);
      const problem = precheck(file) ?? (slots <= 0 ? "quota" : null);
      if (problem) {
        this.entries = this.entries.map((e) =>
          e.key === key ? { ...e, status: "error", error: problem } : e,
        );
        this.deps.announce?.(this.entries.find((e) => e.key === key)!);
      } else {
        slots -= 1;
      }
    }
    this.deps.onChange(this.entries);
    void this.run();
  }

  /** Zopakuje selhanou položku (u už založené fotografie jen s novou adresou). */
  retry(key: string): void {
    const entry = this.entries.find((e) => e.key === key);
    if (!entry || entry.status !== "error" || !this.files.has(key)) return;
    this.update(key, { status: "queued", error: undefined, progress: 0 });
    void this.run();
  }

  /** Odstraní položku z fronty (ne z databáze: tam ji maže správce smazáním fotografie). */
  remove(key: string): void {
    const entry = this.entries.find((e) => e.key === key);
    if (!entry || entry.status === "uploading" || entry.status === "processing") return;
    this.entries = this.entries.filter((e) => e.key !== key);
    this.files.delete(key);
    this.blobs.delete(key);
    if (!this.closed) this.deps.onChange(this.entries);
  }

  clearFinished(): void {
    for (const e of this.entries) if (e.status === "done") this.blobs.delete(e.key);
    this.entries = this.entries.filter((e) => e.status !== "done");
    if (!this.closed) this.deps.onChange(this.entries);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const next = this.entries.find((e) => e.status === "queued");
        if (!next || this.closed) break;
        await this.process(next.key);
      }
    } finally {
      this.running = false;
    }
  }

  private async process(key: string): Promise<void> {
    const file = this.files.get(key);
    if (!file) return;
    const current = () => this.entries.find((e) => e.key === key)!;

    this.update(key, { status: "preparing", attempt: current().attempt + 1 });
    // Zmenšený soubor se při opakování znovu nepočítá: podepsaná adresa nese přesnou velikost, kterou server
    // schválil při založení fotografie, a PUT musí poslat přesně tolik bajtů.
    let blob = this.blobs.get(key);
    if (!blob) {
      try {
        blob = await this.deps.prepare(file);
      } catch {
        blob = file;
      }
      this.blobs.set(key, blob);
    }
    const mime = blob.type && isAcceptedMime(blob.type) ? blob.type : declaredMime(file);
    if (blob.size > MEDIA_LIMITS.maxBytes) return this.fail(key, "too_large");

    // Žádost o podepsanou adresu, nebo její obnovení u už založené fotografie
    let target: { url: string; headers: Record<string, string> };
    let mediaId = current().mediaId;
    try {
      let requested = mediaId
        ? await this.deps.actions.renewUpload({ id: mediaId, mime })
        : await this.deps.actions.requestUpload({ mime, bytes: blob.size });
      if (mediaId && requested.status === "not_found") {
        // Fotografie už není čekající (dokončila se, nebo ji server odmítl): nahraje se jako nová
        mediaId = undefined;
        requested = await this.deps.actions.requestUpload({ mime, bytes: blob.size });
      }
      if (requested.status !== "ok") return this.fail(key, requestError(requested.status));
      target = { url: requested.url, headers: requested.headers };
      mediaId = requested.id;
      this.update(key, { mediaId });
    } catch {
      return this.fail(key, "network");
    }

    // Nahrání přímo do úložiště, s opakováním
    this.update(key, { status: "uploading", progress: 0 });
    let uploaded = false;
    for (let attempt = 0; attempt < PUT_ATTEMPTS && !uploaded; attempt++) {
      try {
        await this.deps.put(target, blob, (percent) => {
          const entry = current();
          if (entry.status === "uploading" && percent !== entry.progress) {
            this.update(key, { progress: percent });
          }
        });
        uploaded = true;
      } catch (error) {
        const status = error instanceof PutError ? error.status : 0;
        // Adresa vypršela nebo ji úložiště odmítlo (403): nová adresa pro tutéž fotografii
        if (status === 403 && attempt < PUT_ATTEMPTS - 1) {
          try {
            const renewed = await this.deps.actions.renewUpload({ id: mediaId!, mime });
            if (renewed.status === "ok") target = { url: renewed.url, headers: renewed.headers };
          } catch {
            // zkusí se znovu se starou adresou, potom skončí chybou
          }
        }
        // Chyby klienta (kromě 403, 408 a 429) se neopakují
        const retryable =
          status === 0 || status === 403 || status === 408 || status === 429 || status >= 500;
        if (!retryable || attempt === PUT_ATTEMPTS - 1) return this.fail(key, "network");
        await this.deps.sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
      }
    }
    this.update(key, { progress: 100 });

    // Zpracování na serveru
    this.update(key, { status: "processing" });
    for (let attempt = 0; attempt < BUSY_ATTEMPTS; attempt++) {
      let result;
      try {
        result = await this.deps.actions.finishUpload(mediaId!);
      } catch {
        // odpověď se ztratila: další pokus vrátí hotovou fotografii (finish je idempotentní), nebo chybu
        if (attempt === BUSY_ATTEMPTS - 1) return this.fail(key, "network");
        await this.deps.sleep(BACKOFF_MS[0]);
        continue;
      }
      if (result.status === "ok") {
        const entry = this.update(key, { status: "done", progress: 100 });
        this.blobs.delete(key);
        if (entry) {
          this.deps.announce?.(entry);
          this.deps.onDone(result.item, entry);
        }
        return;
      }
      if (result.status === "busy") {
        await this.deps.sleep(BACKOFF_MS[1]);
        continue;
      }
      if (result.status === "failed") return this.fail(key, result.code);
      if (result.status === "limited") return this.fail(key, "limited");
      if (result.status === "unavailable") return this.fail(key, "unavailable");
      if (result.status === "unauthorized") return this.fail(key, "closed");
      return this.fail(key, "network");
    }
    return this.fail(key, "busy");
  }
}

function requestError(status: string): QueueError {
  switch (status) {
    case "quota":
      return "quota";
    case "too_large":
      return "too_large";
    case "bad_type":
      return "type";
    case "limited":
      return "limited";
    case "unavailable":
      return "unavailable";
    case "unauthorized":
    case "not_editable":
      return "closed";
    default:
      return "network";
  }
}

// --- prohlížeč: zmenšení a PUT s průběhem -----------------------------------------------------------

/**
 * Volitelné zmenšení před odesláním: nejdelší strana nejvýš 4 000 px (JPEG zůstává JPEG, ostatní WebP), jen
 * když to opravdu zmenší soubor. Cokoli selže (starý prohlížeč bez `OffscreenCanvas`, nedostatek paměti), vrací
 * se původní soubor. Orientace EXIF se promítne do pixelů; EXIF a GPS odstraňuje server tak jako tak.
 */
export async function downscale(
  file: File,
  maxSide: number = MEDIA_LIMITS.preDownscalePx,
): Promise<Blob> {
  try {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
      return file;
    }
    const mime = declaredMime(file);
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") return file;
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= maxSide) {
      bitmap.close();
      return file;
    }
    const scale = maxSide / longest;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await canvas.convertToBlob({
      type: mime === "image/jpeg" ? "image/jpeg" : "image/webp",
      quality: 0.9,
    });
    return blob.size > 0 && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** PUT přes `XMLHttpRequest` (jen ten hlásí průběh nahrávání); `fetch` průběh odesílání neumí. */
export function putWithProgress(
  target: { url: string; headers: Record<string, string> },
  blob: Blob,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.url);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new PutError(xhr.status));
    xhr.onerror = () => reject(new PutError(0));
    xhr.ontimeout = () => reject(new PutError(0));
    xhr.onabort = () => reject(new PutError(0));
    xhr.send(blob);
  });
}
