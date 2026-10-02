"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/icon";
import type { PublicMedia } from "@/site/types";
import { Picture } from "./picture";

/**
 * Mřížka fotografií s přístupným prohlížečem (lightbox). Prohlížeč je nativní modální `<dialog>`:
 *  - zbytek stránky je při otevření nedostupný (inert), Esc zavře, zaměření se vrátí na fotografii, ze které se
 *    prohlížeč otevřel,
 *  - zaměření je uvězněné v dialogu (Tab a Shift+Tab se uvnitř točí), počáteční zaměření dostane tlačítko Zavřít,
 *  - šipky vlevo a vpravo (a Home, End) listují, tlačítka Předchozí a Další dělají totéž myší a dotykem
 *    (WCAG 2.1.1, 2.5.7: žádná akce nevyžaduje tažení),
 *  - každá fotografie má alternativní text (popisek) a ten je zároveň viditelným popiskem; u dekorativní
 *    fotografie je `alt=""` a popisek se nezobrazuje,
 *  - změna fotografie se ohlašuje čtečkám (`aria-live`), obrázky velkého formátu se načtou až po otevření.
 * Bez JavaScriptu je mřížka sada obrázků (tlačítka se jen nic nestane); fotografie jsou součástí stránky.
 */

export interface LightboxItem {
  media: PublicMedia;
  /** Popisek v jazyce stránky (prázdný u dekorativní fotografie). */
  alt: string;
  /** `lang` popisku, když se zobrazil náhradní jazyk (WCAG 3.1.2). */
  lang?: string;
}

export interface LightboxLabels {
  /** Šablona s `{alt}`: název tlačítka u fotografie s popiskem. */
  open: string;
  /** Šablona s `{n}` a `{total}`: název tlačítka u dekorativní fotografie. */
  openN: string;
  dialog: string;
  close: string;
  prev: string;
  next: string;
  /** Šablona s `{n}` a `{total}`. */
  counter: string;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );

const FOCUSABLE = "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

export function GalleryLightbox({
  items,
  labels,
}: {
  items: LightboxItem[];
  labels: LightboxLabels;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const total = items.length;

  const open = (at: number, from: HTMLElement) => {
    trigger.current = from;
    setIndex(at);
  };

  // Dialog se otevře až po vykreslení obsahu: počáteční zaměření (autofocus na Zavřít) tak najde, kam spadnout.
  useEffect(() => {
    const element = dialog.current;
    if (index !== null && element && !element.open) element.showModal();
  }, [index]);

  const close = useCallback(() => {
    dialog.current?.close();
  }, []);

  const onClosed = () => {
    setIndex(null);
    const from = trigger.current;
    trigger.current = null;
    // Prohlížeč vrací zaměření sám; tohle je jistota pro ty, které to nedělají.
    if (from?.isConnected) from.focus();
  };

  const step = (delta: number) =>
    setIndex((current) => (current === null ? current : (current + delta + total) % total));

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setIndex(total - 1);
    } else if (event.key === "Tab") {
      // Uvěznění zaměření: z posledního prvku na první a zpět.
      const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const current = index === null ? null : items[index];

  return (
    <>
      <ul className="site-gallery">
        {items.map((item, at) => (
          <li key={item.media.id}>
            <figure className="site-figure">
              <button
                type="button"
                className="site-photo"
                aria-haspopup="dialog"
                aria-label={
                  item.alt
                    ? fill(labels.open, { alt: item.alt })
                    : fill(labels.openN, { n: at + 1, total })
                }
                onClick={(event) => open(at, event.currentTarget)}
              >
                <Picture
                  media={item.media}
                  alt={item.alt}
                  lang={item.lang}
                  sizes="(min-width: 768px) 30vw, 100vw"
                />
              </button>
            </figure>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        className="site-lightbox"
        aria-label={labels.dialog}
        onClose={onClosed}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          // Klik na pozadí mimo obsah zavře (klávesnicí je Esc a tlačítko Zavřít).
          if (event.target === event.currentTarget) close();
        }}
      >
        {current ? (
          <div className="site-lightbox-body">
            <button
              type="button"
              className="site-lightbox-btn site-lightbox-close"
              onClick={close}
              autoFocus
              aria-label={labels.close}
            >
              <Icon icon={X} size={28} />
            </button>
            <figure className="site-lightbox-figure">
              <Picture
                media={current.media}
                alt={current.alt}
                lang={current.lang}
                sizes="100vw"
                loading="eager"
                className="site-lightbox-img"
              />
              {/* Změna fotografie se ohlásí (popisek, nebo jen pořadí u dekorativní); WCAG 4.1.3 */}
              <figcaption id={`${id}-caption`} aria-live="polite" className="site-lightbox-caption">
                {current.alt ? (
                  <span lang={current.lang} className="site-lightbox-alt">
                    {current.alt}
                  </span>
                ) : null}
                <span className="site-lightbox-count">
                  {fill(labels.counter, { n: (index ?? 0) + 1, total })}
                </span>
              </figcaption>
            </figure>
            {total > 1 ? (
              <>
                <button
                  type="button"
                  className="site-lightbox-btn site-lightbox-prev"
                  onClick={() => step(-1)}
                  aria-label={labels.prev}
                >
                  <Icon icon={ChevronLeft} size={32} />
                </button>
                <button
                  type="button"
                  className="site-lightbox-btn site-lightbox-next"
                  onClick={() => step(1)}
                  aria-label={labels.next}
                >
                  <Icon icon={ChevronRight} size={32} />
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
