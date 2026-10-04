"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

/**
 * Widget Cloudflare Turnstile (ochrana před roboty) v režimu „interaction-only“: běžný návštěvník nic
 * nevidí ani nevyplňuje, výzva se ukáže jen při podezření. Token se předá `onToken` a widget ho vloží i do
 * skrytého pole formuláře (`cf-turnstile-response`), takže ho dostane i Server Action z `FormData`.
 * Bez veřejného klíče (vývoj, testy) se nevykreslí nic a ověření na serveru se přeskočí.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile"));
    script.onerror = () => {
      loading = null;
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export interface TurnstileHandle {
  /** Nový token po odeslání (token je jednorázový). */
  reset: () => void;
}

/** Je ochrana zapnutá (veřejný klíč v sestavení)? */
export const turnstileEnabled = Boolean(SITE_KEY);

export function Turnstile({
  action,
  locale,
  onToken,
  ref,
}: {
  /** Název akce v přehledu Cloudflare (`wizard`, `waitlist`). */
  action: string;
  /** Jazyk výzvy (`cs`, `en`); bez něj podle prohlížeče. */
  locale?: string;
  onToken?: (token: string) => void;
  ref?: Ref<TurnstileHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const callback = useRef(onToken);
  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useImperativeHandle(ref, () => ({
    reset: () => {
      callback.current?.("");
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
    },
  }));

  useEffect(() => {
    if (!SITE_KEY || !container.current) return;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widget.current = api.render(container.current, {
          sitekey: SITE_KEY,
          action,
          language: locale ?? "auto",
          appearance: "interaction-only",
          callback: (token: string) => callback.current?.(token),
          "expired-callback": () => callback.current?.(""),
          "error-callback": () => callback.current?.(""),
        });
      })
      .catch(() => {
        // Skript se nenačetl (blokátor, výpadek): server rozhodne podle chybějícího tokenu.
      });
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [action, locale]);

  if (!SITE_KEY) return null;
  return <div ref={container} className="min-h-0" />;
}
