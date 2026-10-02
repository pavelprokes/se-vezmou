"use client";

import { useEffect, useState } from "react";
import { SiteRenderer } from "@/components/site/site-renderer";
import { htmlLang, isLocale, type Locale } from "@/i18n/config";
import { publicContentSchema, type PublicContent } from "@/site/types";
import { PREVIEW_MESSAGE, PREVIEW_READY } from "./preview";

interface Received {
  content: PublicContent;
  locale: Locale;
  now: Date;
}

/**
 * Obsah rámce živého náhledu (`/vytvorit/nahled`): vykreslí web páru z obsahu, který pošle
 * průvodce (zprávou ze stejného původu). Zprávu z jiného původu ani s neplatným obsahem
 * ignoruje, takže rámec nejde zneužít k vykreslení cizích dat. Obsah prochází stejným schématem
 * jako zveřejněný snímek.
 */
export function PreviewHost({ waiting }: { waiting: string }) {
  const [received, setReceived] = useState<Received | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as { type?: string; content?: unknown; locale?: string } | null;
      if (data?.type !== PREVIEW_MESSAGE || !data.locale || !isLocale(data.locale)) return;
      const parsed = publicContentSchema.safeParse(data.content);
      if (!parsed.success || !parsed.data.locales.includes(data.locale)) return;
      setReceived({ content: parsed.data, locale: data.locale, now: new Date() });
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: PREVIEW_READY }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!received) {
    return (
      <p role="status" className="p-6">
        {waiting}
      </p>
    );
  }
  return (
    <div lang={htmlLang[received.locale]} data-testid="preview-site">
      <SiteRenderer content={received.content} locale={received.locale} now={received.now} />
    </div>
  );
}
