"use client";

import { useEffect, useMemo, useState } from "react";
import type { SiteNamespace } from "@/components/site/context";
import { SiteRenderer } from "@/components/site/site-renderer";
import { htmlLang, isLocale, type Locale } from "@/i18n/config";
import { createTranslator, type LoadedMessages } from "@/i18n/translator";
import {
  publicContentSchema,
  sensitiveContentSchema,
  type PublicContent,
  type SensitiveContent,
} from "@/site/types";
import { PREVIEW_MESSAGE, PREVIEW_READY } from "./preview";

interface Received {
  content: PublicContent;
  locale: Locale;
  sensitive: SensitiveContent | null;
  now: Date;
}

/**
 * Obsah rámce živého náhledu (`/vytvorit/nahled`): vykreslí web páru z obsahu, který pošle
 * průvodce nebo správa webu (zprávou ze stejného původu). Zprávu z jiného původu ani s neplatným
 * obsahem ignoruje, takže rámec nejde zneužít k vykreslení cizích dat. Obsah prochází stejným
 * schématem jako zveřejněný snímek. Správa webu posílá navíc citlivé údaje, které sama zadala
 * (číslo účtu, soukromé adresy); rámec je ukáže odemčené, jen v prohlížeči správce.
 *
 * Překlady webu (`common`, `site`, `rsvp`) pošle server pro každý jazyk, protože web páru může mít
 * jiné jazyky než rozhraní; jiné jmenné prostory se do prohlížeče nedostanou.
 */
export function PreviewHost({
  waiting,
  messages,
}: {
  waiting: string;
  messages: Record<Locale, LoadedMessages<SiteNamespace>>;
}) {
  const [received, setReceived] = useState<Received | null>(null);
  const t = useMemo(
    () => (received ? createTranslator(messages[received.locale]) : null),
    [messages, received],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as {
        type?: string;
        content?: unknown;
        locale?: string;
        sensitive?: unknown;
      } | null;
      if (data?.type !== PREVIEW_MESSAGE || !data.locale || !isLocale(data.locale)) return;
      const parsed = publicContentSchema.safeParse(data.content);
      if (!parsed.success || !parsed.data.locales.includes(data.locale)) return;
      const sensitive =
        data.sensitive == null ? null : sensitiveContentSchema.safeParse(data.sensitive);
      setReceived({
        content: parsed.data,
        locale: data.locale,
        sensitive: sensitive?.success ? sensitive.data : null,
        now: new Date(),
      });
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: PREVIEW_READY }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!received || !t) {
    return (
      <p role="status" className="p-6">
        {waiting}
      </p>
    );
  }
  return (
    // `inert`: náhled je jen obrázek webu. Bez toho by Tab procházel desítky odkazů a tlačítek
    // zmenšeného webu (2.4.3) a čtečka by četla web, který nejde použít; textovou podobu má krok Kontrola.
    <div lang={htmlLang[received.locale]} data-testid="preview-site" inert>
      <SiteRenderer
        content={received.content}
        t={t}
        now={received.now}
        sensitiveUnlocked={received.sensitive !== null}
        sensitive={received.sensitive}
      />
    </div>
  );
}
