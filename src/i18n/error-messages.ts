import type { Locale } from "./config";
import cs from "./messages/cs/errors.json";
import en from "./messages/en/errors.json";

/**
 * Texty chyby kořenového layoutu (`src/app/global-error.tsx`). Je to klientská komponenta, která se
 * zobrazí, když selže samotné vykreslení na serveru, takže nemůže zavolat `loadMessages`. Proto jako
 * jediná výjimka staticky vkládá malý jmenný prostor `errors` (pár vět) ve všech jazycích; žádný jiný
 * jmenný prostor sem nepatří (hlídá `src/i18n/imports.test.ts`).
 */
export const errorMessages: Record<Locale, typeof cs> = { cs, en };
