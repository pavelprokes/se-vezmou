import type { Locale } from "@/i18n/config";
import { typo } from "@/i18n/typo";
import { formatDateRange } from "@/site/format";
import type { I18nText } from "@/site/i18n-text";

const COPY: Record<Locale, (date: string) => string> = {
  cs: (date) => `Změna termínu: svatba se bude konat ${date}.`,
  en: (date) => `Change of date: the wedding will take place on ${date}.`,
};

/**
 * Předvyplněný text pruhu „Změna termínu“ ve všech jazycích webu. Datum bere z nastavení svatby
 * (`YYYY-MM-DD`); bez platného data vrací `null`, protože věta bez data by hosty jen zmátla.
 */
export function dateChangeNotice(
  locales: readonly Locale[],
  startsOn: string | null | undefined,
  endsOn?: string | null,
): I18nText | null {
  if (!startsOn || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return null;
  const notice: I18nText = {};
  for (const locale of locales) {
    notice[locale] = typo(COPY[locale](formatDateRange(startsOn, endsOn ?? null, locale)), locale);
  }
  return notice;
}
