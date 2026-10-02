import { intlLocale, type Locale } from "@/i18n/config";
import { typo } from "@/i18n/typo";

/**
 * Datum a čas webu páru. Vše se počítá v časovém pásmu svatby (`timezone`), ne v pásmu serveru
 * nebo hosta (docs/data-model.md, kapitola 7).
 */

/** `2027-06-12` -> poledne UTC téhož dne; v žádném pásmu mezi UTC-11 a UTC+12 se den nezmění. */
function dayToDate(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

export function formatDay(
  day: string,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "long" },
): string {
  // Pásmo UTC: `dayToDate` je poledne UTC, takže se den nikdy neposune.
  return typo(
    new Intl.DateTimeFormat(intlLocale[locale], { ...options, timeZone: "UTC" }).format(
      dayToDate(day),
    ),
    locale,
  );
}

export function formatTime(iso: string, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale[locale], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(iso));
}

/** Kalendářní den okamžiku v pásmu (`YYYY-MM-DD`), podle něhož se program seskupuje po dnech. */
export function dayInZone(iso: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(typeof iso === "string" ? new Date(iso) : iso);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Počet kalendářních dní od dneška (v pásmu svatby) do `day`; záporné po svatbě. */
export function daysUntil(day: string, timeZone: string, now: Date): number {
  const today = dayInZone(now, timeZone);
  return Math.round((dayToDate(day).getTime() - dayToDate(today).getTime()) / 86_400_000);
}

/** Rozsah dnů svatby: jeden den, nebo od-do (vícedenní svatba). */
export function formatDateRange(startsOn: string, endsOn: string | null, locale: Locale): string {
  if (!endsOn || endsOn === startsOn) return formatDay(startsOn, locale);
  return `${formatDay(startsOn, locale)} – ${formatDay(endsOn, locale)}`;
}
