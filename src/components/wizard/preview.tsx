"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";
import { toPublicContent, previewPhase } from "@/wizard/content";
import type { WizardDraft } from "@/wizard/draft";
import type { PublicContent } from "@/site/types";
import { useT } from "./i18n";

/** Zprávy mezi průvodcem a rámcem náhledu (`/vytvorit/nahled`); oba konce kontrolují původ. */
export const PREVIEW_MESSAGE = "sv-preview";
export const PREVIEW_READY = "sv-preview-ready";

export const PREVIEW_PATH = { cs: "/vytvorit/nahled", en: "/en/vytvorit/nahled" } as const;

const FRAMES = {
  phone: { width: 390, height: 800 },
  desktop: { width: 1280, height: 800 },
} as const;

function subscribeResize(callback: () => void): () => void {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

type Device = keyof typeof FRAMES;

/** Obsah náhledu z konceptu; při nehotovém konceptu zástupné hodnoty, nikdy výjimka. */
export function previewContentOf(draft: WizardDraft): PublicContent | null {
  try {
    return toPublicContent(draft, {
      placeholders: true,
      phase: previewPhase(draft),
      slug: draft.slug || "nahled",
    });
  } catch {
    return null;
  }
}

/**
 * Živý náhled webu v rámci stejného původu: rámec je skutečný dokument s šířkou telefonu nebo
 * počítače, takže se šablona chová jako u hostů (CSS podle šířky okna). Obsah se předává zprávou,
 * rámec nic nečte z úložiště. Rámec má popisek (WCAG 4.1.2) a obsah je jen ke čtení.
 */
export function PreviewPanel({
  draft,
  uiLocale,
  className,
}: {
  draft: WizardDraft;
  uiLocale: Locale;
  className?: string;
}) {
  const t = useT();
  const [device, setDevice] = useState<Device>("phone");
  const [chosen, setChosen] = useState<Locale>(draft.defaultLocale);
  const locale = draft.locales.includes(chosen) ? chosen : draft.defaultLocale;
  const content = useMemo(() => previewContentOf(draft), [draft]);

  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef({ content, locale });
  const [width, setWidth] = useState(0);

  // Poslední stav pro odpověď na „ready“ (rámec se může načíst později než první zpráva).
  useEffect(() => {
    latest.current = { content, locale };
    frame.current?.contentWindow?.postMessage(
      { type: PREVIEW_MESSAGE, content, locale },
      window.location.origin,
    );
  }, [content, locale]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow ||
        (event.data as { type?: string } | null)?.type !== PREVIEW_READY
      ) {
        return;
      }
      frame.current?.contentWindow?.postMessage(
        { type: PREVIEW_MESSAGE, ...latest.current },
        window.location.origin,
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Rámec se vejde nad spodní lištu s tlačítky Zpět a Další i na nízkém okně.
  const viewportHeight = useSyncExternalStore(
    subscribeResize,
    () => window.innerHeight,
    () => 900,
  );
  const size = {
    width: FRAMES[device].width,
    height: Math.max(420, Math.min(FRAMES[device].height, viewportHeight - 320)),
  };
  const scale = width > 0 ? Math.min(1, width / size.width) : 1;

  return (
    <section aria-labelledby="wz-preview-title" className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="wz-preview-title" className="text-xl font-medium">
          {t("wizard.preview.title")}
        </h2>
        <div className="flex flex-wrap gap-2">
          <div role="group" aria-label={t("wizard.preview.device")} className="flex gap-1">
            {(["phone", "desktop"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={device === value}
                onClick={() => setDevice(value)}
                className={cn(
                  "min-h-target rounded-button inline-flex cursor-pointer items-center gap-2 border-2 px-3 text-base",
                  device === value
                    ? "border-pine bg-pine text-parchment"
                    : "border-pine text-pine hover:bg-linen bg-transparent",
                )}
              >
                <Icon icon={value === "phone" ? Smartphone : Monitor} size={18} />
                {t(value === "phone" ? "wizard.preview.phone" : "wizard.preview.desktop")}
              </button>
            ))}
          </div>
          {draft.locales.length > 1 ? (
            <div role="group" aria-label={t("wizard.preview.language")} className="flex gap-1">
              {draft.locales.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={locale === value}
                  lang={value}
                  onClick={() => setChosen(value)}
                  className={cn(
                    "min-h-target min-w-target rounded-button cursor-pointer border-2 px-3 text-base",
                    locale === value
                      ? "border-pine bg-pine text-parchment"
                      : "border-pine text-pine hover:bg-linen bg-transparent",
                  )}
                >
                  {value.toUpperCase()}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <p className="text-muted text-sm">{t("wizard.preview.hint")}</p>

      <div ref={box} className="border-hairline w-full overflow-hidden rounded-2xl border bg-white">
        <div
          className="mx-auto overflow-hidden"
          style={{ width: size.width * scale, height: size.height * scale }}
        >
          <iframe
            ref={frame}
            title={t("wizard.preview.frameTitle")}
            src={`${PREVIEW_PATH[uiLocale]}`}
            data-testid="preview-frame"
            style={{
              width: size.width,
              height: size.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              border: 0,
              display: "block",
              background: "white",
            }}
          />
        </div>
      </div>
    </section>
  );
}

/** Náhled v dialogu pro mobil; rámec se vytváří, až když je dialog otevřený. */
export function PreviewDialog({
  open,
  onClose,
  draft,
  uiLocale,
}: {
  open: boolean;
  onClose: () => void;
  draft: WizardDraft;
  uiLocale: Locale;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={t("wizard.preview.title")}
      onClose={onClose}
      className="bg-parchment text-ink m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto p-4 backdrop:bg-black/70"
    >
      {open ? (
        <div className="mx-auto flex max-w-xl flex-col gap-4">
          <PreviewPanel draft={draft} uiLocale={uiLocale} />
          <button
            type="button"
            onClick={onClose}
            className="min-h-target rounded-button border-pine bg-pine text-parchment cursor-pointer border-2 px-5 text-base font-medium"
          >
            {t("wizard.preview.close")}
          </button>
        </div>
      ) : null}
    </dialog>
  );
}
