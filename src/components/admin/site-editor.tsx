"use client";

import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  EyeOff,
  GripVertical,
  History,
  LoaderCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorActions } from "@/admin/site/action-types";
import type { MediaActions } from "@/lib/media/action-types";
import type { MediaItem } from "@/lib/media/types";
import {
  docToPublic,
  moveBlock,
  moveBlockTo,
  setBlockEnabled,
  translationGaps,
  validateDoc,
  type EditorBlock,
  type EditorDoc,
  type Issue,
  type IssueCode,
  type SiteMeta,
} from "@/admin/site/doc";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/choice";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { phaseFromDates } from "@/site/phase";
import type { BlockType } from "@/site/types";
import { BlockForm, type CardOutcome, type EditorContext } from "./blocks";
import { ConfirmButton } from "./confirm-button";
import { GeneralPanel } from "./general";
import { useAdminT, type AdminKey } from "./i18n";
import { QuickNotice } from "./quick-notice";
import { SitePreview } from "./preview";

export const BLOCK_TITLES: Record<BlockType, AdminKey> = {
  hero: "admin.block.hero.title",
  program: "admin.block.program.title",
  venue: "admin.block.venue.title",
  lodging: "admin.block.lodging.title",
  dresscode: "admin.block.dresscode.title",
  faq: "admin.block.faq.title",
  contact: "admin.block.contact.title",
  story: "admin.block.story.title",
  gifts: "admin.block.gifts.title",
  gallery: "admin.block.gallery.title",
  rsvp: "admin.block.rsvp.title",
};

const BLOCK_HELP: Record<BlockType, AdminKey> = {
  hero: "admin.block.hero.help",
  program: "admin.block.program.help",
  venue: "admin.block.venue.help",
  lodging: "admin.block.lodging.help",
  dresscode: "admin.block.dresscode.help",
  faq: "admin.block.faq.help",
  contact: "admin.block.contact.help",
  story: "admin.block.story.help",
  gifts: "admin.block.gifts.help",
  gallery: "admin.block.gallery.help",
  rsvp: "admin.block.rsvp.help",
};

const ISSUE_TEXT: Record<IssueCode, AdminKey> = {
  names: "admin.issue.names",
  date: "admin.issue.date",
  dateOrder: "admin.issue.dateOrder",
  defaultLocale: "admin.issue.defaultLocale",
  palette: "admin.issue.palette",
  venueAddress: "admin.issue.venueAddress",
  venueName: "admin.issue.venueName",
  venueUrl: "admin.issue.venueUrl",
  venueNone: "admin.issue.venueNone",
  eventTitle: "admin.issue.eventTitle",
  eventTime: "admin.issue.eventTime",
  eventVenue: "admin.issue.eventVenue",
  dresscodeEmpty: "admin.issue.dresscodeEmpty",
  storyEmpty: "admin.issue.storyEmpty",
  giftsAccount: "admin.issue.giftsAccount",
  galleryUrl: "admin.issue.galleryUrl",
  photoNoCaption: "admin.issue.photoNoCaption",
  lodgingUrl: "admin.issue.lodgingUrl",
  lodgingName: "admin.issue.lodgingName",
  faqIncomplete: "admin.issue.faqIncomplete",
  contactName: "admin.issue.contactName",
  contactEmail: "admin.issue.contactEmail",
  contactPhone: "admin.issue.contactPhone",
  emptyBlock: "admin.issue.emptyBlock",
  guestPinMissing: "admin.issue.guestPinMissing",
  build: "admin.issue.build",
};

export type ClientMeta = Pick<
  SiteMeta,
  | "slug"
  | "status"
  | "rev"
  | "hasGuestPin"
  | "guestPinEnabled"
  | "publishedVersionNo"
  | "hasUnpublishedChanges"
  | "quickNotice"
  | "quickNoticeEnabled"
>;

type SaveState =
  "saved" | "dirty" | "saving" | "error" | "invalid" | "conflict" | "limited" | "closed";

const AUTOSAVE_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SiteEditorProps {
  uiLocale: Locale;
  initial: { doc: EditorDoc; meta: ClientMeta };
  actions: EditorActions;
  /** Média svatby (fotografie) z databáze při otevření editoru. */
  initialMedia: MediaItem[];
  mediaActions: MediaActions;
  /** Úložiště fotografií je nastavené. */
  photosAvailable: boolean;
  siteHref: string | null;
  historyHref: string;
  /** Poslední verze je stará: při otevření editoru se uloží bod pro vrácení. */
  needsCheckpoint: boolean;
}

/**
 * Editor webu páru (FR-ADM-1, FR-ADM-2, FR-ADM-3, FR-WEB-2): obecné údaje, bloky po jazycích se
 * zapínáním a řazením, průběžné ukládání konceptu, zveřejnění, stažení z publikace, bod pro vrácení
 * a živý náhled. Pracovní kopie se ukládá sama (kontrola revize chrání před přepsáním z jiného okna);
 * zveřejnit jde jen uloženou kopii, kterou server znovu zkontroluje.
 */
export function SiteEditor({
  uiLocale,
  initial,
  actions,
  initialMedia,
  mediaActions,
  photosAvailable,
  siteHref,
  historyHref,
  needsCheckpoint,
}: SiteEditorProps) {
  const t = useAdminT();
  const [doc, setDoc] = useState(initial.doc);
  const [meta, setMeta] = useState(initial.meta);
  const [media, setMediaState] = useState<MediaItem[]>(initialMedia);
  const setMedia = useCallback((fn: (items: MediaItem[]) => MediaItem[]) => setMediaState(fn), []);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [announce, setAnnounce] = useState("");
  // Rozbalených sekcí může být víc najednou (porovnání, dlouhé úpravy); sbalit jde každou zvlášť.
  const [openBlocks, setOpenBlocks] = useState<ReadonlySet<string>>(new Set());
  const setOpen = (id: string, open: boolean) =>
    setOpenBlocks((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  const [moved, setMoved] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "publish" | "unpublish" | "checkpoint">(null);
  const [result, setResult] = useState<{
    kind: "ok" | "error";
    text: string;
    issues?: Issue[];
  } | null>(null);

  const latest = useRef(initial.doc);
  const rev = useRef(initial.meta.rev);
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failed = useRef(false);

  const guestPinReady = meta.guestPinEnabled && meta.hasGuestPin;
  const issues = useMemo(
    () => validateDoc(doc, { guestPinReady, media }),
    [doc, guestPinReady, media],
  );
  const errors = issues.filter((issue) => issue.severity === "error");
  const gaps = useMemo(() => translationGaps(doc, media), [doc, media]);

  const preview = useMemo(
    () =>
      docToPublic(doc, {
        slug: meta.slug ?? "nahled",
        quickNotice: meta.quickNoticeEnabled ? meta.quickNotice : null,
        phase: phaseFromDates(
          { startsOn: doc.wedding.startsOn, endsOn: doc.wedding.endsOn },
          new Date(),
          doc.wedding.timezone,
        ),
        media,
      }),
    [doc, media, meta.slug, meta.quickNotice, meta.quickNoticeEnabled],
  );

  const flush = useCallback(async (): Promise<boolean> => {
    if (saving.current) return false;
    saving.current = true;
    setSaveState("saving");
    let ok = false;
    try {
      for (;;) {
        dirty.current = false;
        const snapshot = latest.current;
        const response = await actions.save({ doc: snapshot, baseRev: rev.current });
        if (response.status === "saved") {
          rev.current = response.rev;
          failed.current = false;
          if (dirty.current) continue;
          setSaveState("saved");
          setSavedAt(new Date());
          setAnnounce("saved");
          ok = true;
        } else if (response.status === "conflict") {
          setSaveState("conflict");
          setAnnounce("conflict");
        } else if (response.status === "limited") {
          setSaveState("limited");
          setAnnounce("limited");
        } else if (response.status === "not_editable" || response.status === "unauthorized") {
          setSaveState("closed");
          setAnnounce("closed");
        } else if (response.status === "invalid") {
          // Neplatný údaj se nezkouší dokola: uloží se až po opravě (další úprava spustí nové uložení).
          failed.current = true;
          setSaveState("invalid");
          setAnnounce("invalid");
        } else {
          failed.current = true;
          dirty.current = true;
          setSaveState("error");
          setAnnounce("error");
        }
        break;
      }
    } catch {
      failed.current = true;
      dirty.current = true;
      setSaveState("error");
      setAnnounce("error");
    } finally {
      saving.current = false;
    }
    return ok;
  }, [actions]);

  const schedule = useCallback(
    (delay = AUTOSAVE_MS) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, delay);
    },
    [flush],
  );

  // Po chybě sítě se uložení zkusí samo znovu.
  useEffect(() => {
    if (saveState !== "error") return;
    const id = setTimeout(() => schedule(0), 5000);
    return () => clearTimeout(id);
  }, [saveState, schedule]);

  const update = useCallback(
    (fn: (current: EditorDoc) => EditorDoc) => {
      const next = fn(latest.current);
      latest.current = next;
      dirty.current = true;
      setDoc(next);
      setMeta((m) => ({ ...m, hasUnpublishedChanges: true }));
      setSaveState((state) => (state === "saving" || state === "conflict" ? state : "dirty"));
      schedule();
    },
    [schedule],
  );

  /** Počká na dokončené uložení (zveřejnit jde jen to, co je uložené). */
  const ensureSaved = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    for (let i = 0; i < 200 && saving.current; i++) await sleep(50);
    if (dirty.current) return flush();
    return !failed.current;
  }, [flush]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const checkpointed = useRef(false);
  useEffect(() => {
    if (!needsCheckpoint || checkpointed.current) return;
    checkpointed.current = true;
    // Bod pro vrácení ze stavu při otevření editoru (poslední verze je stará); selhání nevadí.
    void actions.checkpoint(t("admin.history.autoNote")).catch(() => undefined);
  }, [needsCheckpoint, actions, t]);

  const refreshCard = useCallback(
    async (url: string): Promise<CardOutcome> => {
      try {
        const response = await actions.refreshGalleryCard(url);
        if (response.status === "ok" || response.status === "failed") return response;
        if (response.status === "invalid_url" || response.status === "limited") return response;
        return { status: "error" };
      } catch {
        return { status: "error" };
      }
    },
    [actions],
  );

  const ctx: EditorContext = {
    doc,
    locales: doc.wedding.locales,
    guestPinReady,
    update,
    refreshCard,
    media,
    setMedia,
    mediaActions,
    photosAvailable,
  };

  // --- řazení bloků ------------------------------------------------------------------------

  function move(block: EditorBlock, delta: -1 | 1) {
    const next = moveBlock(latest.current.blocks, block.id, delta);
    update((d) => ({ ...d, blocks: next }));
    const position = next.findIndex((b) => b.id === block.id) + 1;
    setMoved(
      t("admin.blocks.moved", { name: t(BLOCK_TITLES[block.type]), position, total: next.length }),
    );
    // Po přeskupení DOM zaměření vrátíme na stejné tlačítko (nebo na protější, když je to krajní).
    requestAnimationFrame(() => {
      const same = document.getElementById(`move-${block.id}-${delta === -1 ? "up" : "down"}`);
      const other = document.getElementById(`move-${block.id}-${delta === -1 ? "down" : "up"}`);
      const target = same instanceof HTMLButtonElement && !same.disabled ? same : other;
      if (target instanceof HTMLElement) target.focus();
    });
  }

  function drop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const block = latest.current.blocks.find((b) => b.id === dragId);
    const next = moveBlockTo(latest.current.blocks, dragId, targetId);
    update((d) => ({ ...d, blocks: next }));
    if (block) {
      const position = next.findIndex((b) => b.id === block.id) + 1;
      setMoved(
        t("admin.blocks.moved", {
          name: t(BLOCK_TITLES[block.type]),
          position,
          total: next.length,
        }),
      );
    }
    setDragId(null);
  }

  // --- zveřejnění ------------------------------------------------------------------------------

  async function publish() {
    setBusy("publish");
    setResult(null);
    try {
      // Co editor sám pozná jako chybu (prázdné jméno, neplatná paleta), na server ani nejde.
      if (errors.length > 0) {
        setResult({ kind: "error", text: t("admin.publish.invalid"), issues: errors });
        return;
      }
      if (!(await ensureSaved())) {
        setResult({ kind: "error", text: t("admin.publish.notSaved") });
        return;
      }
      const response = await actions.publish(note);
      if (response.status === "published") {
        setMeta((m) => ({
          ...m,
          status: "published",
          publishedVersionNo: response.versionNo,
          hasUnpublishedChanges: false,
        }));
        setNote("");
        setResult({
          kind: "ok",
          text: t("admin.publish.done", { version: response.versionNo }),
          issues: response.warnings,
        });
      } else if (response.status === "invalid") {
        setResult({ kind: "error", text: t("admin.publish.invalid"), issues: response.issues });
      } else if (response.status === "limited") {
        setResult({ kind: "error", text: t("admin.error.limited") });
      } else if (response.status === "unauthorized") {
        setResult({ kind: "error", text: t("admin.error.unauthorized") });
      } else {
        setResult({ kind: "error", text: t("admin.publish.failed") });
      }
    } catch {
      setResult({ kind: "error", text: t("admin.publish.failed") });
    } finally {
      setBusy(null);
    }
  }

  async function unpublish() {
    setBusy("unpublish");
    setResult(null);
    try {
      const response = await actions.unpublish();
      if (response.status === "ok") {
        setMeta((m) => ({ ...m, status: "draft" }));
        setResult({ kind: "ok", text: t("admin.unpublish.done") });
      } else {
        setResult({ kind: "error", text: t("admin.unpublish.failed") });
      }
    } catch {
      setResult({ kind: "error", text: t("admin.unpublish.failed") });
    } finally {
      setBusy(null);
    }
  }

  async function checkpoint() {
    setBusy("checkpoint");
    setResult(null);
    try {
      if (!(await ensureSaved())) {
        setResult({ kind: "error", text: t("admin.publish.notSaved") });
        return;
      }
      const response = await actions.checkpoint(note);
      if (response.status === "ok") {
        setNote("");
        setResult({
          kind: "ok",
          text: t("admin.checkpoint.done", { version: response.versionNo }),
        });
      } else {
        setResult({ kind: "error", text: t("admin.checkpoint.failed") });
      }
    } catch {
      setResult({ kind: "error", text: t("admin.checkpoint.failed") });
    } finally {
      setBusy(null);
    }
  }

  function jumpTo(issue: Issue) {
    const blockType: BlockType | null =
      issue.area === "wedding"
        ? null
        : issue.area === "events"
          ? "program"
          : issue.area === "venues"
            ? "venue"
            : issue.area;
    if (blockType) {
      const block = doc.blocks.find((b) => b.type === blockType);
      if (block) setOpen(block.id, true);
    }
    setView("edit");
    requestAnimationFrame(() => {
      const target =
        (issue.itemId &&
          document.getElementById(
            `${issue.area === "events" ? "event" : issue.area === "gallery" ? "photo" : "venue"}-${issue.itemId}`,
          )) ||
        document.getElementById(blockType ? `block-${blockType}` : "panel-general");
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: "start" });
        const heading = target.querySelector("h3, h4, h2");
        if (heading instanceof HTMLElement) {
          heading.tabIndex = -1;
          heading.focus();
        }
      }
    });
  }

  const published = meta.status === "published";
  const statusText = published
    ? meta.hasUnpublishedChanges
      ? t("admin.status.changed", { version: meta.publishedVersionNo ?? 0 })
      : t("admin.status.published", { version: meta.publishedVersionNo ?? 0 })
    : t("admin.status.unpublished");

  const saveText =
    saveState === "saving"
      ? t("admin.save.saving")
      : saveState === "dirty"
        ? t("admin.save.dirty")
        : saveState === "error"
          ? t("admin.save.error")
          : saveState === "invalid"
            ? t("admin.save.invalid")
            : saveState === "conflict"
              ? t("admin.save.conflict")
              : saveState === "limited"
                ? t("admin.save.limited")
                : saveState === "closed"
                  ? t("admin.save.closed")
                  : savedAt
                    ? t("admin.save.savedAt", {
                        time: new Intl.DateTimeFormat(uiLocale === "cs" ? "cs-CZ" : "en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(savedAt),
                      })
                    : t("admin.save.saved");

  const announceText =
    announce === "saved"
      ? t("admin.save.announce.saved")
      : announce === "error"
        ? t("admin.save.error")
        : announce === "invalid"
          ? t("admin.save.invalid")
          : announce === "conflict"
            ? t("admin.save.conflict")
            : announce === "limited"
              ? t("admin.save.limited")
              : announce === "closed"
                ? t("admin.save.closed")
                : "";

  const blocks = doc.blocks;
  const locked = saveState === "conflict" || saveState === "closed";

  return (
    <div className="flex flex-col gap-6">
      {/* Stav a zveřejnění */}
      <Card as="section" aria-labelledby="publish-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="publish-heading" className="text-2xl font-medium">
              {t("admin.publish.title")}
            </h2>
            <p className="mt-1 flex items-center gap-2 text-lg" data-testid="site-status">
              <Icon icon={published ? CircleCheck : EyeOff} />
              <span>{statusText}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {siteHref && published ? (
              <a
                href={siteHref}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "secondary" })}
              >
                {t("admin.publish.viewSite")}
                <Icon icon={ExternalLink} size={18} />
                <span className="sr-only">{t("admin.common.newTab")}</span>
              </a>
            ) : null}
            <a href={historyHref} className={buttonVariants({ variant: "secondary" })}>
              <Icon icon={History} size={18} />
              {t("admin.publish.history")}
            </a>
          </div>
        </div>

        <p
          className="text-muted flex items-center gap-2"
          aria-hidden="true"
          data-testid="save-state"
        >
          <Icon
            icon={
              saveState === "saving"
                ? LoaderCircle
                : saveState === "error" ||
                    saveState === "invalid" ||
                    saveState === "conflict" ||
                    saveState === "limited" ||
                    saveState === "closed"
                  ? CircleAlert
                  : CircleCheck
            }
            size={18}
          />
          {saveText}
        </p>
        <p role="status" aria-live="polite" className="sr-only">
          {announceText}
        </p>
        {saveState === "conflict" ? (
          <p className="text-cinnamon-deep flex items-start gap-2 font-medium" role="alert">
            <Icon icon={CircleAlert} className="mt-1" />
            <span>
              {t("admin.save.conflictHelp")}{" "}
              <a href="" className="underline underline-offset-4">
                {t("admin.save.reload")}
              </a>
            </span>
          </p>
        ) : null}

        <Field
          label={t("admin.publish.note")}
          hint={t("admin.publish.noteHint")}
          autoComplete="off"
          maxLength={200}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="flex flex-wrap items-start gap-3">
          <Button type="button" onClick={() => void publish()} disabled={busy !== null || locked}>
            {busy === "publish"
              ? t("admin.common.saving")
              : published
                ? t("admin.publish.update")
                : t("admin.publish.publish")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void checkpoint()}
            disabled={busy !== null || locked}
          >
            {t("admin.checkpoint.save")}
          </Button>
          {published ? (
            <ConfirmButton
              label={t("admin.unpublish.button")}
              question={t("admin.unpublish.question")}
              confirmLabel={t("admin.unpublish.confirm")}
              disabled={busy !== null || locked}
              onConfirm={() => void unpublish()}
            />
          ) : null}
        </div>

        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {result ? (
            <p
              className={cn(
                "flex items-start gap-2 font-medium",
                result.kind === "ok" ? "text-pine" : "text-cinnamon-deep",
              )}
              data-testid="publish-result"
            >
              <Icon icon={result.kind === "ok" ? CircleCheck : CircleAlert} className="mt-1" />
              <span>{result.text}</span>
            </p>
          ) : null}
        </div>

        {(result?.issues && result.issues.length > 0) || errors.length > 0 ? (
          <IssueList issues={result?.issues ?? errors} onJump={jumpTo} />
        ) : null}
      </Card>

      <div className="flex gap-2 lg:hidden" role="group" aria-label={t("admin.view.label")}>
        {(["edit", "preview"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => setView(value)}
            className={cn(
              "min-h-target rounded-button flex-1 cursor-pointer border-2 px-3 text-base font-medium",
              view === value
                ? "border-pine bg-pine text-parchment"
                : "border-pine text-pine hover:bg-linen bg-transparent",
            )}
          >
            {value === "edit" ? t("admin.view.edit") : t("admin.view.preview")}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <div className={cn("flex min-w-0 flex-col gap-6", view === "preview" && "max-lg:hidden")}>
          <Card as="section" id="panel-general" aria-labelledby="general-heading">
            <h2 id="general-heading" className="mb-4 text-2xl font-medium">
              {t("admin.general.title")}
            </h2>
            <GeneralPanel doc={doc} uiLocale={uiLocale} update={update} />
          </Card>

          <Card as="section" aria-labelledby="blocks-heading">
            <h2 id="blocks-heading" className="text-2xl font-medium">
              {t("admin.blocks.title")}
            </h2>
            <p className="text-muted mt-2">{t("admin.blocks.hint")}</p>
            <p role="status" aria-live="polite" className="sr-only" data-testid="moved">
              {moved}
            </p>
            <ol className="mt-4 flex flex-col gap-3">
              {blocks.map((block) => {
                const isHero = block.type === "hero";
                const open = openBlocks.has(block.id);
                const name = t(BLOCK_TITLES[block.type]);
                const rest = blocks.filter((b) => b.type !== "hero");
                const restIndex = rest.findIndex((b) => b.id === block.id);
                return (
                  <li
                    key={block.id}
                    id={`block-${block.type}`}
                    draggable={!isHero}
                    onDragStart={() => setDragId(block.id)}
                    onDragEnd={() => setDragId(null)}
                    onDragOver={(event) => {
                      if (dragId && !isHero) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!isHero) drop(block.id);
                    }}
                    data-testid={`block-${block.type}`}
                    data-enabled={block.enabled}
                    className={cn(
                      "border-hairline rounded-2xl border",
                      block.enabled ? "bg-parchment" : "bg-linen",
                      dragId === block.id && "opacity-60",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2 p-3">
                      {isHero ? (
                        <span className="w-6" aria-hidden="true" />
                      ) : (
                        <span
                          aria-hidden="true"
                          title={t("admin.blocks.drag")}
                          className="text-muted cursor-grab"
                        >
                          <Icon icon={GripVertical} />
                        </span>
                      )}
                      <h3 className="min-w-0 flex-1 font-sans text-lg font-semibold">
                        <span>{name}</span>
                        {!block.enabled ? (
                          <span className="text-muted ml-2 inline-flex items-center gap-1 text-sm font-normal">
                            <Icon icon={EyeOff} size={16} />
                            {t("admin.blocks.hidden")}
                          </span>
                        ) : null}
                      </h3>
                      {isHero ? (
                        <span className="text-muted text-sm">{t("admin.blocks.heroFixed")}</span>
                      ) : (
                        <>
                          <Checkbox
                            label={t("admin.blocks.show")}
                            aria-label={t("admin.blocks.showLabel", { name })}
                            checked={block.enabled}
                            onChange={(event) => {
                              update((d) => ({
                                ...d,
                                blocks: setBlockEnabled(d.blocks, block.id, event.target.checked),
                              }));
                              if (event.target.checked) setOpen(block.id, true);
                            }}
                          />
                          <Button
                            id={`move-${block.id}-up`}
                            type="button"
                            variant="secondary"
                            aria-label={t("admin.blocks.up", { name })}
                            disabled={restIndex <= 0}
                            onClick={() => move(block, -1)}
                          >
                            <Icon icon={ArrowUp} />
                          </Button>
                          <Button
                            id={`move-${block.id}-down`}
                            type="button"
                            variant="secondary"
                            aria-label={t("admin.blocks.down", { name })}
                            disabled={restIndex === rest.length - 1}
                            onClick={() => move(block, 1)}
                          >
                            <Icon icon={ArrowDown} />
                          </Button>
                        </>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        aria-expanded={open}
                        aria-controls={`block-form-${block.id}`}
                        aria-label={
                          open
                            ? t("admin.blocks.collapseLabel", { name })
                            : t("admin.blocks.editLabel", { name })
                        }
                        onClick={() => setOpen(block.id, !open)}
                      >
                        {open ? t("admin.blocks.collapse") : t("admin.blocks.edit")}
                      </Button>
                    </div>
                    {open ? (
                      <div
                        id={`block-form-${block.id}`}
                        className="border-hairline flex flex-col gap-5 border-t p-4"
                      >
                        <p className="text-muted">{t(BLOCK_HELP[block.type])}</p>
                        <BlockForm block={block} ctx={ctx} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card as="section" aria-labelledby="translations-heading">
            <h2 id="translations-heading" className="text-2xl font-medium">
              {t("admin.translation.title")}
            </h2>
            {doc.wedding.locales.length < 2 ? (
              <p className="text-muted mt-2">{t("admin.translation.single")}</p>
            ) : gaps.length === 0 ? (
              <p className="mt-2 flex items-center gap-2" data-testid="translations-ok">
                <Icon icon={CircleCheck} />
                {t("admin.translation.ok")}
              </p>
            ) : (
              <>
                <p className="text-muted mt-2">{t("admin.translation.hint")}</p>
                <ul className="mt-3 flex flex-col gap-2" data-testid="translation-gaps">
                  {gaps.map((gap) => (
                    <li
                      key={`${gap.area}-${gap.locale}`}
                      className="text-cinnamon-deep flex items-start gap-2 font-medium"
                    >
                      <Icon icon={CircleAlert} className="mt-1" />
                      <span>
                        {t("admin.translation.gap", {
                          area: gapArea(t, gap.area),
                          language: gap.locale === "cs" ? t("admin.lang.cs") : t("admin.lang.en"),
                          count: gap.count,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card as="section" aria-labelledby="quick-heading">
            <h2 id="quick-heading" className="mb-4 text-2xl font-medium">
              {t("admin.quick.title")}
            </h2>
            <QuickNotice
              initial={{ notice: meta.quickNotice, enabled: meta.quickNoticeEnabled }}
              locales={doc.wedding.locales}
              action={actions.quickNotice}
              published={published}
              onSaved={(value) =>
                setMeta((m) => ({
                  ...m,
                  quickNotice: value.notice,
                  quickNoticeEnabled: value.enabled,
                }))
              }
            />
          </Card>
        </div>

        <div
          className={cn(
            "min-w-0 lg:sticky lg:top-4 lg:self-start",
            view === "edit" && "max-lg:hidden",
          )}
        >
          <SitePreview
            content={preview?.content ?? null}
            sensitive={preview?.sensitive ?? null}
            siteLocales={doc.wedding.locales}
            defaultLocale={doc.wedding.defaultLocale}
            uiLocale={uiLocale}
          />
        </div>
      </div>
    </div>
  );
}

function gapArea(t: ReturnType<typeof useAdminT>, area: BlockType | "events" | "venues"): string {
  if (area === "events") return t("admin.events.title");
  if (area === "venues") return t("admin.venue.title");
  return t(BLOCK_TITLES[area]);
}

/** Seznam chyb a upozornění k zveřejnění; každá položka umí skočit na místo opravy. */
function IssueList({ issues, onJump }: { issues: Issue[]; onJump: (issue: Issue) => void }) {
  const t = useAdminT();
  return (
    <ul className="flex flex-col gap-2" data-testid="issues">
      {issues.map((issue, index) => (
        <li
          key={`${issue.code}-${issue.itemId ?? ""}-${index}`}
          className="flex flex-wrap items-center gap-2"
        >
          <span
            className={cn(
              "flex items-start gap-2",
              issue.severity === "error" ? "text-cinnamon-deep font-medium" : "text-muted",
            )}
          >
            <Icon icon={CircleAlert} className="mt-1" />
            <span>
              <span className="font-semibold">
                {issue.severity === "error" ? t("admin.issue.error") : t("admin.issue.warning")}:
              </span>{" "}
              {t(ISSUE_TEXT[issue.code])}
            </span>
          </span>
          <Button type="button" variant="text" onClick={() => onJump(issue)}>
            {t("admin.issue.fix")}
          </Button>
        </li>
      ))}
    </ul>
  );
}
