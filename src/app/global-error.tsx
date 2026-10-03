"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { defaultLocale, htmlLang, locales } from "@/i18n/config";
import { errorMessages } from "@/i18n/error-messages";

/**
 * Chyba kořenového layoutu: jazyk návštěvníka tu není spolehlivě znám, proto se zpráva ukáže ve
 * všech jazycích (výchozí první), každá část s vlastním `lang` (WCAG 3.1.2). Stránka má titulek
 * a hlavní oblast. Texty jsou jen z malého jmenného prostoru `errors` (`src/i18n/error-messages.ts`),
 * aby se do prohlížeče nenačítaly katalogy.
 */
const MESSAGES = [defaultLocale, ...locales.filter((l) => l !== defaultLocale)].map((locale) => ({
  lang: htmlLang[locale],
  errors: errorMessages[locale],
}));

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
    <html lang={htmlLang[defaultLocale]}>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", lineHeight: 1.6 }}>
        <title>{MESSAGES.map(({ errors }) => errors["error.title"]).join(" | ")}</title>
        <main
          id="obsah"
          style={{ maxWidth: "40rem", margin: "0 auto", padding: "3rem 1rem", color: "#1b2a23" }}
        >
          {MESSAGES.map(({ lang, errors }) => (
            <section key={lang} lang={lang} style={{ marginBottom: "2rem" }}>
              <h1 style={{ fontSize: "1.75rem", lineHeight: 1.2 }}>{errors["error.title"]}</h1>
              <p>{errors["error.body"]}</p>
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
                {errors["error.retry"]}
              </button>
            </section>
          ))}
        </main>
      </body>
    </html>
  );
}
