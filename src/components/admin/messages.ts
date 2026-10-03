import "server-only";
import type { Locale } from "@/i18n/config";
import { pickMessages } from "@/i18n/load";
import type { AdminMessages } from "./i18n";

/** Zprávy `admin.*` a `admin.guests.*` v jazyce pro prohlížeč (jen tyto jmenné prostory). */
export function pickAdminMessages(locale: Locale): Promise<AdminMessages> {
  return pickMessages(locale, ["admin", "admin.guests"]);
}
