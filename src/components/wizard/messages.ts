import "server-only";
import type { Locale } from "@/i18n/config";
import { catalogs } from "@/i18n/messages";
import type { WizardMessages } from "./i18n";

/** Zprávy `wizard.*` v jazyce pro prohlížeč (jen tyto, ne celý katalog). */
export function pickWizardMessages(locale: Locale): WizardMessages {
  const out: WizardMessages = {};
  for (const [key, value] of catalogs[locale]) {
    if (key.startsWith("wizard.")) out[key] = value;
  }
  return out;
}
