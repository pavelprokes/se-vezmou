"use client";

import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  CircleCheck,
  Download,
  GripVertical,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Icon } from "@/components/ui/icon";
import type { MediaActions, PhotoDownload } from "@/lib/media/action-types";
import { ACCEPT_ATTRIBUTE, MEDIA_LIMITS } from "@/lib/media/limits";
import { isReady, mediaSrc, type MediaItem } from "@/lib/media/types";
import type { Locale } from "@/i18n/config";
import type { I18nText } from "@/site/i18n-text";
import { ConfirmButton } from "./confirm-button";
import { LocalizedField, Note } from "./fields";
import { useAdminT, type AdminKey, type AdminT } from "./i18n";
import {
  UploadQueue,
  downscale,
  putWithProgress,
  type QueueEntry,
  type QueueError,
} from "./upload-queue";

/**
 * Fotografie páru v editoru galerie (docs/adr/0006-photo-storage.md, FR-WEB-5): nahrání, popisek po jazycích,
 * příznak dekorativní, řazení (tlačítky i přetažením, WCAG 2.5.7), smazání a export. Přístupnost (WCAG 2.2 AA):
 *  - výběr souborů je nativní pole s viditelným popiskem a `accept` jen na JPEG, PNG a WebP,
 *  - fronta nahrávání je seznam s `<progress>` a textovým stavem; živá oblast ohlašuje jen dokončení a chyby,
 *    ne každé procento,
 *  - řazení: tlačítka Výš a Níž (po přesunu se zaměření vrací na stejné tlačítko a nová pozice se ohlásí),
 *    přetažení je jen doplněk,
 *  - chybějící popisek a chybějící překlad jsou upozornění textem s ikonou, ne jen barvou,
 *  - smazání se potvrzuje druhým krokem přímo v místě.
 * Stav (seznam médií, pořadí v dokumentu) drží nadřazený editor, aby živý náhled ukazoval fotografie hned.
 */

const ERROR_KEYS: Record<QueueError, AdminKey> = {
  type: "admin.photos.error.type",
  heic: "admin.photos.error.heic",
  too_large: "admin.photos.error.too_large",
  quota: "admin.photos.error.quota",
  network: "admin.photos.error.network",
  limited: "admin.photos.error.limited",
  unavailable: "admin.photos.error.unavailable",
  closed: "admin.photos.error.closed",
  busy: "admin.photos.error.busy",
  unsupported_type: "admin.photos.error.unsupported_type",
  too_many_pixels: "admin.photos.error.too_many_pixels",
  corrupt: "admin.photos.error.corrupt",
  empty: "admin.photos.error.empty",
  missing_file: "admin.photos.error.missing_file",
  storage: "admin.photos.error.storage",
  expired: "admin.photos.error.expired",
  internal: "admin.photos.error.internal",
};

const STATUS_KEYS = {
  queued: "admin.photos.status.queued",
  preparing: "admin.photos.status.preparing",
  uploading: "admin.photos.status.uploading",
  processing: "admin.photos.status.processing",
  done: "admin.photos.status.done",
} as const satisfies Record<Exclude<QueueEntry["status"], "error">, AdminKey>;

const SIZE_MB = MEDIA_LIMITS.maxBytes / (1024 * 1024);
const MEGAPIXELS = MEDIA_LIMITS.maxPixels / 1_000_000;

/** Srozumitelná zpráva k chybě nahrávání nebo zpracování (kód chyby je jen identifikátor). */
function errorMessage(t: AdminT, code: string | null): string {
  const key = ERROR_KEYS[(code ?? "internal") as QueueError] ?? ERROR_KEYS.internal;
  return t(key, { size: SIZE_MB, max: MEDIA_LIMITS.maxPhotos, mp: MEGAPIXELS });
}

/** Fotografie v pořadí z dokumentu, potom ty, které v něm ještě nejsou (např. nahrané těsně před zavřením okna). */
export function orderedPhotos(media: readonly MediaItem[], ids: readonly string[]): MediaItem[] {
  const photos = media.filter((m) => m.kind === "photo");
  const byId = new Map(photos.map((m) => [m.id, m]));
  const placed = ids.map((id) => byId.get(id)).filter((m): m is MediaItem => m !== undefined);
  const placedIds = new Set(placed.map((m) => m.id));
  return [...placed, ...photos.filter((m) => !placedIds.has(m.id))];
}

export interface PhotosPanelProps {
  /** Pořadí fotografií v dokumentu (`gallery.mediaIds`). */
  ids: readonly string[];
  media: readonly MediaItem[];
  setMedia: (fn: (items: MediaItem[]) => MediaItem[]) => void;
  /** Pořadí, přidání a odebrání v dokumentu (ukládá se jako koncept). */
  onReorder: (ids: string[]) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  actions: MediaActions;
  /** Úložiště je nastavené (jinak se nahrávání nenabízí). */
  available: boolean;
  locales: readonly Locale[];
  photosProtected: boolean;
  onProtectedChange: (value: boolean) => void;
  guestPinReady: boolean;
}

type SaveState = "saving" | "saved" | "error";

export function PhotosPanel(props: PhotosPanelProps) {
  const { media, setMedia, actions, available, locales } = props;
  const t = useAdminT();
  const baseId = useId();

  const photos = orderedPhotos(media, props.ids);
  const readyCount = media.filter((m) => m.kind === "photo" && m.status !== "failed").length;
  const slotsLeft = Math.max(0, MEDIA_LIMITS.maxPhotos - readyCount);

  const [entries, setEntries] = useState<readonly QueueEntry[]>([]);
  const [announce, setAnnounce] = useState("");
  const [moved, setMoved] = useState("");
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [removeMessage, setRemoveMessage] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<
    null | { status: "ok"; files: PhotoDownload[] } | { status: "empty" | "error" | "limited" }
  >(null);
  const [exporting, setExporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);

  // Nejnovější hodnoty pro zpětná volání fronty (fronta žije déle než jedno vykreslení)
  const latest = useRef({ ...props, slotsLeft, t });
  useEffect(() => {
    latest.current = { ...props, slotsLeft, t };
  });

  const queue = useRef<UploadQueue | null>(null);
  useEffect(() => {
    const q = new UploadQueue({
      actions: {
        requestUpload: (i) => latest.current.actions.requestUpload(i),
        renewUpload: (i) => latest.current.actions.renewUpload(i),
        finishUpload: (id) => latest.current.actions.finishUpload(id),
      },
      put: putWithProgress,
      prepare: (file) => downscale(file),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      slotsLeft: () => latest.current.slotsLeft,
      onChange: setEntries,
      // Dokončení a chyby se ohlašují čtečkám (průběh v procentech ne)
      announce: (entry) => {
        const text = latest.current.t;
        setAnnounce(
          entry.status === "done"
            ? text("admin.photos.announce.done", { name: entry.name })
            : text("admin.photos.announce.error", {
                name: entry.name,
                error: errorMessage(text, entry.error ?? null),
              }),
        );
      },
      onDone: (item) => {
        latest.current.setMedia((items) => [...items.filter((m) => m.id !== item.id), item]);
        latest.current.onAdd(item.id);
      },
    });
    queue.current = q;
    return () => {
      q.dispose();
      queue.current = null;
    };
  }, []);

  const errorText = (code: string | null) => errorMessage(t, code);

  function statusText(entry: QueueEntry): string {
    if (entry.status === "error") return errorText(entry.error ?? "internal");
    if (entry.status === "uploading") {
      return t(STATUS_KEYS.uploading, { percent: entry.progress });
    }
    return t(STATUS_KEYS[entry.status]);
  }

  // --- popisky -------------------------------------------------------------------------------

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
    };
  }, []);

  const persist = useCallback(async (id: string, alt: I18nText | null, decorative: boolean) => {
    setSaveState((s) => ({ ...s, [id]: "saving" }));
    try {
      const result = await latest.current.actions.update({
        id,
        alt: alt as { cs?: string; en?: string } | null,
        decorative,
      });
      setSaveState((s) => ({ ...s, [id]: result.status === "ok" ? "saved" : "error" }));
    } catch {
      setSaveState((s) => ({ ...s, [id]: "error" }));
    }
  }, []);

  function editMedia(
    item: MediaItem,
    patch: { alt?: I18nText | null; decorative?: boolean },
    now = false,
  ) {
    const next = { ...item, ...patch };
    setMedia((items) => items.map((m) => (m.id === item.id ? next : m)));
    const pending = timers.current.get(item.id);
    if (pending) clearTimeout(pending);
    const save = () => {
      timers.current.delete(item.id);
      void persist(item.id, next.alt, next.decorative);
    };
    if (now) save();
    else timers.current.set(item.id, setTimeout(save, 600));
  }

  // --- pořadí ---------------------------------------------------------------------------------

  const currentIds = photos.map((m) => m.id);

  function reorder(from: number, to: number, focusId?: string) {
    if (to < 0 || to >= currentIds.length || from === to) return;
    const next = [...currentIds];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    props.onReorder(next);
    setMoved(t("admin.photos.moved", { position: to + 1, total: next.length }));
    if (focusId) {
      requestAnimationFrame(() => {
        const same = document.getElementById(`${baseId}-${focusId}-${to < from ? "up" : "down"}`);
        const other = document.getElementById(`${baseId}-${focusId}-${to < from ? "down" : "up"}`);
        const target = same instanceof HTMLButtonElement && !same.disabled ? same : other;
        if (target instanceof HTMLElement) target.focus();
      });
    }
  }

  // --- mazání ----------------------------------------------------------------------------------

  async function remove(item: MediaItem) {
    setRemoveMessage("");
    try {
      const result = await actions.remove(item.id);
      if (result.status === "ok" || result.status === "not_found") {
        setMedia((items) => items.filter((m) => m.id !== item.id));
        props.onRemove(item.id);
        setRemoveMessage(t("admin.photos.deleted"));
        requestAnimationFrame(() => listHeading.current?.focus());
        return;
      }
    } catch {
      // zpráva níže
    }
    setRemoveMessage(t("admin.photos.deleteFailed"));
  }

  async function exportAll() {
    setExporting(true);
    setDownloads(null);
    try {
      const result = await actions.exportPhotos();
      if (result.status === "ok") setDownloads({ status: "ok", files: result.files });
      else if (result.status === "empty") setDownloads({ status: "empty" });
      else if (result.status === "limited") setDownloads({ status: "limited" });
      else setDownloads({ status: "error" });
    } catch {
      setDownloads({ status: "error" });
    } finally {
      setExporting(false);
    }
  }

  const activeQueue = entries;
  const inQueue = new Set(
    entries
      .filter((e) => e.mediaId && e.status !== "error" && e.status !== "done")
      .map((e) => e.mediaId),
  );
  const full = slotsLeft === 0;
  const hasDone = entries.some((e) => e.status === "done");

  return (
    <section aria-labelledby={`${baseId}-title`} className="flex flex-col gap-5">
      <h4 id={`${baseId}-title`} className="text-ink font-sans text-base font-semibold">
        {t("admin.photos.title")}
      </h4>
      <p className="text-muted">
        {t("admin.photos.intro", {
          max: MEDIA_LIMITS.maxPhotos,
          size: SIZE_MB,
          mp: MEGAPIXELS,
        })}
      </p>

      {/* Výběr souborů */}
      {available ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${baseId}-file`} className="text-ink font-medium">
            {t("admin.photos.add")}
          </label>
          <p id={`${baseId}-file-hint`} className="text-muted text-sm">
            {t("admin.photos.addHint")} {full ? "" : t("admin.photos.left", { count: slotsLeft })}
          </p>
          <input
            ref={input}
            id={`${baseId}-file`}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            multiple
            disabled={full}
            aria-describedby={`${baseId}-file-hint`}
            className="min-h-target border-field-border bg-parchment text-ink file:bg-pine file:text-parchment w-full cursor-pointer rounded-xl border-2 p-2 text-base file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-lg file:border-0 file:px-4 file:py-1.5 file:font-medium disabled:cursor-not-allowed disabled:opacity-60"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              // Výběr se vymaže, aby šel stejný soubor vybrat znovu (po chybě)
              event.target.value = "";
              if (files.length > 0) queue.current?.add(files);
            }}
          />
          {full ? (
            <Note tone="info">{t("admin.photos.full", { max: MEDIA_LIMITS.maxPhotos })}</Note>
          ) : null}
        </div>
      ) : (
        <Note>{t("admin.photos.unavailable")}</Note>
      )}

      {/* Živá oblast: dokončení a chyby (ne procenta) */}
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>

      {/* Fronta nahrávání */}
      {activeQueue.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h5 className="text-ink font-sans text-base font-semibold">
              {t("admin.photos.queue")}
            </h5>
            {hasDone ? (
              <Button type="button" variant="text" onClick={() => queue.current?.clearFinished()}>
                {t("admin.photos.clearDone")}
              </Button>
            ) : null}
          </div>
          <ul aria-label={t("admin.photos.queueLabel")} className="flex flex-col gap-2">
            {activeQueue.map((entry) => {
              const failed = entry.status === "error";
              return (
                <li
                  key={entry.key}
                  className="border-hairline bg-parchment flex flex-col gap-2 rounded-2xl border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-ink font-medium break-all">{entry.name}</span>
                    <span className="flex items-center gap-2 text-sm">
                      {failed ? (
                        <Icon icon={CircleAlert} size={18} className="text-cinnamon-deep" />
                      ) : entry.status === "done" ? (
                        <Icon icon={CircleCheck} size={18} className="text-pine" />
                      ) : (
                        <Icon
                          icon={LoaderCircle}
                          size={18}
                          className="text-muted motion-safe:animate-spin"
                        />
                      )}
                      <span className={failed ? "text-cinnamon-deep font-medium" : "text-muted"}>
                        {statusText(entry)}
                      </span>
                    </span>
                  </div>
                  {!failed && entry.status !== "done" ? (
                    <progress
                      className="h-2 w-full"
                      max={100}
                      // Zpracování na serveru nemá měřitelný průběh: neurčitý ukazatel
                      value={entry.status === "processing" ? undefined : entry.progress}
                      aria-label={t("admin.photos.progress", { name: entry.name })}
                    />
                  ) : null}
                  {failed || entry.status === "done" || entry.status === "queued" ? (
                    <div className="flex flex-wrap gap-2">
                      {failed && entry.error !== "type" && entry.error !== "heic" ? (
                        <Button
                          type="button"
                          variant="secondary"
                          aria-label={t("admin.photos.retryNamed", { name: entry.name })}
                          onClick={() => queue.current?.retry(entry.key)}
                        >
                          <Icon icon={RotateCcw} />
                          {t("admin.photos.retry")}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="text"
                        aria-label={t("admin.photos.dismissNamed", { name: entry.name })}
                        onClick={() => queue.current?.remove(entry.key)}
                      >
                        <Icon icon={X} />
                        {t("admin.photos.dismiss")}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Nahrané fotografie */}
      <div className="flex flex-col gap-3">
        <h5
          ref={listHeading}
          tabIndex={-1}
          className="text-ink font-sans text-base font-semibold focus:outline-none"
        >
          {t("admin.photos.list", { count: photos.length })}
        </h5>
        {photos.length > 1 ? (
          <p className="text-muted text-sm">{t("admin.photos.dragHint")}</p>
        ) : null}
        <div role="status" aria-live="polite" className="sr-only">
          {moved}
        </div>
        <div
          role="status"
          aria-live="polite"
          className={removeMessage ? "text-muted text-sm" : "sr-only"}
        >
          {removeMessage}
        </div>
        {photos.length === 0 ? <p className="text-muted">{t("admin.photos.empty")}</p> : null}
        <ol className="flex flex-col gap-4">
          {photos
            .filter((item) => !inQueue.has(item.id))
            .map((item) => {
              const index = currentIds.indexOf(item.id);
              const n = index + 1;
              return (
                <li
                  key={item.id}
                  id={`photo-${item.id}`}
                  onDragOver={(event) => {
                    if (dragId && dragId !== item.id) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragId && dragId !== item.id) {
                      reorder(currentIds.indexOf(dragId), index, dragId);
                    }
                    setDragId(null);
                  }}
                  className="border-hairline bg-parchment flex flex-col gap-4 rounded-2xl border p-4 data-[dragging=true]:opacity-60"
                  data-dragging={dragId === item.id}
                >
                  <PhotoRow
                    item={item}
                    n={n}
                    total={photos.length}
                    idBase={`${baseId}-${item.id}`}
                    locales={locales}
                    saveState={saveState[item.id]}
                    onEdit={(patch, now) => editMedia(item, patch, now)}
                    onMove={(delta) => reorder(index, index + delta, item.id)}
                    onRemove={() => void remove(item)}
                    onDragStart={() => setDragId(item.id)}
                    onDragEnd={() => setDragId(null)}
                    errorText={errorText}
                  />
                </li>
              );
            })}
        </ol>
      </div>

      {/* Ochrana PINem hostů */}
      <div className="flex flex-col gap-2">
        <Checkbox
          label={t("admin.photos.protected")}
          checked={props.photosProtected}
          onChange={(event) => props.onProtectedChange(event.target.checked)}
        />
        <Note tone="info">{t("admin.photos.protectedHint")}</Note>
        {props.photosProtected && !props.guestPinReady ? (
          <Note>{t("admin.gifts.pinMissing")}</Note>
        ) : null}
      </div>

      {/* Export */}
      {available && photos.some(isReady) ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void exportAll()}
              disabled={exporting}
            >
              <Icon icon={Download} />
              {t("admin.photos.export")}
            </Button>
          </div>
          <p className="text-muted text-sm">{t("admin.photos.exportHint")}</p>
          <div role="status" aria-live="polite">
            {downloads?.status === "empty" ? (
              <Note tone="info">{t("admin.photos.exportEmpty")}</Note>
            ) : null}
            {downloads?.status === "error" ? <Note>{t("admin.photos.exportFailed")}</Note> : null}
            {downloads?.status === "limited" ? (
              <Note>{t("admin.photos.exportLimited")}</Note>
            ) : null}
            {downloads?.status === "ok" ? (
              <>
                <p className="text-ink font-medium">{t("admin.photos.exportLinks")}</p>
                <ul className="flex flex-col gap-1">
                  {downloads.files.map((file) => (
                    <li key={file.name}>
                      <a
                        href={file.url}
                        download={file.name}
                        className="text-pine underline underline-offset-2"
                      >
                        {t("admin.photos.exportLink", {
                          name: file.name,
                          size: (file.bytes / (1024 * 1024)).toFixed(1),
                        })}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PhotoRow({
  item,
  n,
  total,
  idBase,
  locales,
  saveState,
  onEdit,
  onMove,
  onRemove,
  onDragStart,
  onDragEnd,
  errorText,
}: {
  item: MediaItem;
  n: number;
  total: number;
  idBase: string;
  locales: readonly Locale[];
  saveState: SaveState | undefined;
  onEdit: (patch: { alt?: I18nText | null; decorative?: boolean }, now?: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  errorText: (code: string | null) => string;
}) {
  const t = useAdminT();
  const heading = useId();
  const ready = isReady(item);
  const thumb = ready ? item.widths[0] : null;
  const hasCaption = locales.some((l) => Boolean(item.alt?.[l]?.trim()));

  return (
    <div role="group" aria-labelledby={heading} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h6 id={heading} className="text-ink font-sans text-base font-semibold">
          {t("admin.photos.item", { n, total })}
        </h6>
        {ready ? (
          <div className="flex flex-wrap items-center gap-1">
            {/* Přetažení je jen doplněk pro myš; pořadí jde změnit i tlačítky (WCAG 2.5.7) */}
            <span
              aria-hidden="true"
              draggable
              className="text-muted inline-flex cursor-grab p-2"
              title={t("admin.photos.drag", { n })}
              onDragStart={(event) => {
                onDragStart();
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
                const row = event.currentTarget.closest("li");
                if (row) event.dataTransfer.setDragImage(row, 16, 16);
              }}
              onDragEnd={onDragEnd}
            >
              <Icon icon={GripVertical} />
            </span>
            <Button
              id={`${idBase}-up`}
              type="button"
              variant="secondary"
              disabled={n === 1}
              aria-label={t("admin.photos.up", { n })}
              onClick={() => onMove(-1)}
            >
              <Icon icon={ArrowUp} />
            </Button>
            <Button
              id={`${idBase}-down`}
              type="button"
              variant="secondary"
              disabled={n === total}
              aria-label={t("admin.photos.down", { n })}
              onClick={() => onMove(1)}
            >
              <Icon icon={ArrowDown} />
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        {ready && thumb !== null && item.width && item.height ? (
          // eslint-disable-next-line @next/next/no-img-element -- náhled přes vlastní adresu, popisek je v polích vedle
          <img
            src={mediaSrc(item.id, thumb, "webp")}
            width={item.width}
            height={item.height}
            alt=""
            loading="lazy"
            className="h-auto w-full max-w-48 shrink-0 self-start rounded-xl"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {ready ? (
            <>
              <LocalizedField
                label={t("admin.photos.caption")}
                hint={t("admin.photos.captionHint")}
                locales={locales}
                value={item.alt}
                maxLength={300}
                onChange={(alt) => onEdit({ alt })}
              />
              <Checkbox
                label={t("admin.photos.decorative")}
                checked={item.decorative}
                onChange={(event) => onEdit({ decorative: event.target.checked }, true)}
              />
              {item.decorative ? <Note tone="info">{t("admin.photos.decorativeHint")}</Note> : null}
              {!item.decorative && !hasCaption ? <Note>{t("admin.photos.noCaption")}</Note> : null}
              <div role="status" aria-live="polite" className="text-sm">
                {saveState === "saving" ? (
                  <span className="text-muted">{t("admin.photos.saving")}</span>
                ) : saveState === "saved" ? (
                  <span className="text-muted">{t("admin.photos.saved")}</span>
                ) : saveState === "error" ? (
                  <Note>{t("admin.photos.saveFailed")}</Note>
                ) : null}
              </div>
            </>
          ) : item.status === "failed" ? (
            <Note>{t("admin.photos.failed", { reason: errorText(item.failureCode) })}</Note>
          ) : (
            <Note tone="info">{t("admin.photos.pending")}</Note>
          )}
          <div>
            <ConfirmButton
              variant="text"
              label={t("admin.photos.delete")}
              ariaLabel={t("admin.photos.deleteNamed", { n })}
              question={t("admin.photos.deleteQuestion", { n })}
              confirmLabel={t("admin.photos.deleteConfirm")}
              onConfirm={onRemove}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
