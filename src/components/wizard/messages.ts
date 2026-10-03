import "server-only";
import type { Locale } from "@/i18n/config";
import { pickMessages } from "@/i18n/load";
import type { WizardMessages } from "./i18n";

/** Zprávy `wizard.*` v jazyce pro prohlížeč (jen tento jmenný prostor, ne celý katalog). */
export function pickWizardMessages(locale: Locale): Promise<WizardMessages> {
  return pickMessages(locale, ["wizard"]);
}
