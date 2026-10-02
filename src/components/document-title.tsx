"use client";

import { useEffect } from "react";

/**
 * Nastaví titulek dokumentu v prohlížeči. Stránku 404 Next.js po hydrataci vrátí na výchozí titulek
 * kořenového layoutu (metadata souboru `not-found` se na klientu zahodí), takže bez tohoto přepsání
 * by měla 404 titulek značky jako každá jiná stránka (WCAG 2.4.2). Server titulek posílá správně
 * (`notFoundMetadata`), tohle jen drží stav i po hydrataci.
 */
export function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
    // Next titulek vrací po dokončení hydratace; pozorovatel ho drží, dokud je stránka otevřená.
    const observer = new MutationObserver(() => {
      if (document.title !== title) document.title = title;
    });
    const head = document.head;
    observer.observe(head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
  return null;
}
