import "server-only";
import type { Locale } from "@/i18n/config";
import { catalogs } from "@/i18n/messages";
import type { AdminMessages } from "./i18n";

/** Zprávy `admin.*` v jazyce pro prohlížeč (jen tyto, ne celý katalog). */
export function pickAdminMessages(locale: Locale): AdminMessages {
  const out: AdminMessages = {};
  for (const [key, value] of catalogs[locale]) {
    if (key.startsWith("admin.")) out[key] = value;
  }
  return out;
}
