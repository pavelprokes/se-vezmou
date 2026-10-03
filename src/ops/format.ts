import { defaultLocale, intlLocale, type Locale } from "@/i18n/config";
import { typo } from "@/i18n/typo";

/**
 * Formátování pro operátorskou administraci (v jazyce rozhraní, pražský čas). Datum bez času
 * (`2027-06-12`) se bere jako kalendářní den bez posunu pásma; okamžiky se ukazují v pásmu Europe/Prague.
 */

const TIME_ZONE = "Europe/Prague";

const DAY: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  timeZone: TIME_ZONE,
};

const MOMENT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
};

const MONTH: Intl.DateTimeFormatOptions = { month: "long", year: "numeric", timeZone: "UTC" };

function format(options: Intl.DateTimeFormatOptions, value: Date, locale: Locale): string {
  return typo(new Intl.DateTimeFormat(intlLocale[locale], options).format(value), locale);
}

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  // kalendářní den: poledne UTC, aby ho žádné pásmo neposunulo na sousední den
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
}

/** `12. 6. 2027`, nebo `fallback`, když hodnota chybí. */
export function formatDay(
  value: string | Date | null | undefined,
  fallback: string,
  locale: Locale = defaultLocale,
): string {
  return value ? format(DAY, toDate(value), locale) : fallback;
}

/** `2. 10. 2026 14:05` v pražském čase. */
export function formatMoment(
  value: string | Date | null | undefined,
  fallback: string,
  locale: Locale = defaultLocale,
): string {
  return value ? format(MOMENT, toDate(value), locale) : fallback;
}

/** `2027-06` -> `červen 2027`. */
export function formatMonth(value: string, locale: Locale = defaultLocale): string {
  return format(MONTH, new Date(`${value}-15T12:00:00Z`), locale);
}

/** Jména páru pro nadpis a odkazy: `Klára a Matěj`. */
export function coupleNames(a: string, b: string): string {
  return `${a} a ${b}`;
}

/** Je řetězec datem ve tvaru `RRRR-MM-DD` (a skutečným dnem)? */
export function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Začátek kalendářního dne (`2027-06-12`) v pražském čase jako okamžik; používá se u filtrů „od data“ a „do data“.
 * Posun pásma se bere k půlnoci UTC, takže se na přechodu letního času může lišit o hodinu, což u filtru
 * auditu po dnech nevadí.
 */
export function pragueDayStart(day: string): Date {
  const utc = new Date(`${day}T00:00:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(utc)
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const local = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return new Date(utc.getTime() - (local - utc.getTime()));
}
