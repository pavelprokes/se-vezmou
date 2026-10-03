"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import csCommon from "@/i18n/messages/cs/common.json";
import enCommon from "@/i18n/messages/en/common.json";

/**
 * Chyba kořenového layoutu: jazyk návštěvníka tu není spolehlivě znám, proto se zpráva ukáže česky
 * i anglicky, každá část s vlastním `lang` (WCAG 3.1.2). Stránka má titulek a hlavní oblast.
 * Překlady se berou jen z katalogu `common`, aby se do prohlížeče nenačítaly všechny.
 */
const MESSAGES = [
  { lang: "cs", common: csCommon },
  { lang: "en-GB", common: enCommon },
] as const;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="cs">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", lineHeight: 1.6 }}>
        <title>{`${csCommon["error.title"]} | ${enCommon["error.title"]}`}</title>
        <main
          id="obsah"
          style={{ maxWidth: "40rem", margin: "0 auto", padding: "3rem 1rem", color: "#1b2a23" }}
        >
          {MESSAGES.map(({ lang, common }) => (
            <section key={lang} lang={lang} style={{ marginBottom: "2rem" }}>
              <h1 style={{ fontSize: "1.75rem", lineHeight: 1.2 }}>{common["error.title"]}</h1>
              <p>{common["error.body"]}</p>
              <button
                type="button"
                onClick={() => reset()}
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  padding: "0.5rem 1.25rem",
                  fontSize: "1rem",
                  color: "#f7f4ed",
                  background: "#365c4e",
                  border: "2px solid #365c4e",
                  borderRadius: 10,
                  cursor: "pointer",
                }}
              >
                {common["error.retry"]}
              </button>
            </section>
          ))}
        </main>
      </body>
    </html>
  );
}
