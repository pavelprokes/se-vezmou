"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icon";
import { PREVIEW_MESSAGE, PREVIEW_PATH, PREVIEW_READY } from "@/components/wizard/preview";
import type { Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import type { PublicContent, SensitiveContent } from "@/site/types";
import { useAdminT } from "./i18n";

const FRAMES = {
  phone: { width: 390, height: 800 },
  desktop: { width: 1280, height: 800 },
} as const;

type Device = keyof typeof FRAMES;

function subscribeResize(callback: () => void): () => void {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

/**
 * Živý náhled upravovaného webu: komponenty webu z M6 ve stejném rámci jako u průvodce
 * (`/vytvorit/nahled`, stejný původ), obsah se předává zprávou. Rámec je skutečný dokument se
 * šířkou telefonu nebo počítače, takže se šablona chová jako u hostů. Citlivé údaje (číslo účtu,
 * soukromé adresy) vidí v náhledu jen správce, který je zadal; rámec je ukáže jako odemčené.
 */
export function SitePreview({
  content,
  sensitive,
  siteLocales,
  defaultLocale,
  uiLocale,
}: {
  content: PublicContent | null;
  sensitive: SensitiveContent | null;
  siteLocales: readonly Locale[];
  defaultLocale: Locale;
  uiLocale: Locale;
}) {
  const t = useAdminT();
  const [device, setDevice] = useState<Device>("phone");
  const [chosen, setChosen] = useState<Locale>(defaultLocale);
  const locale = siteLocales.includes(chosen) ? chosen : defaultLocale;

  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef({ content, locale, sensitive });
  const [width, setWidth] = useState(0);

  useEffect(() => {
    latest.current = { content, locale, sensitive };
    frame.current?.contentWindow?.postMessage(
      { type: PREVIEW_MESSAGE, content, locale, sensitive },
      window.location.origin,
    );
  }, [content, locale, sensitive]);

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

  const viewportHeight = useSyncExternalStore(
    subscribeResize,
    () => window.innerHeight,
    () => 900,
  );
  const size = {
    width: FRAMES[device].width,
    height: Math.max(420, Math.min(FRAMES[device].height, viewportHeight - 200)),
  };
  const scale = width > 0 ? Math.min(1, width / size.width) : 1;

  return (
    <section aria-labelledby="preview-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="preview-title" className="text-xl font-medium">
          {t("admin.preview.title")}
        </h2>
        <div className="flex flex-wrap gap-2">
          <div role="group" aria-label={t("admin.preview.device")} className="flex gap-1">
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
                {value === "phone" ? t("admin.preview.phone") : t("admin.preview.desktop")}
              </button>
            ))}
          </div>
          {siteLocales.length > 1 ? (
            <div role="group" aria-label={t("admin.preview.language")} className="flex gap-1">
              {siteLocales.map((value) => (
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
      <p className="text-muted text-sm">{t("admin.preview.hint")}</p>
      <div ref={box} className="border-hairline w-full overflow-hidden rounded-2xl border bg-white">
        <div
          className="mx-auto overflow-hidden"
          style={{ width: size.width * scale, height: size.height * scale }}
        >
          <iframe
            ref={frame}
            title={t("admin.preview.frameTitle")}
            src={PREVIEW_PATH[uiLocale]}
            data-testid="site-preview-frame"
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
