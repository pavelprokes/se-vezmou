/**
 * Datum a čas v časovém pásmu svatby -> ISO řetězec s posunem (`2027-06-19T14:00:00+02:00`).
 * Letní a zimní čas se řeší přes `Intl`, bez závislosti na knihovně pro data.
 */

export const DEFAULT_TIMEZONE = "Europe/Prague";

/** Posun pásma od UTC v minutách v daném okamžiku (kladný východně od Greenwiche). */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** `zonedIso("2027-06-19", "14:00")` -> `2027-06-19T14:00:00+02:00`. Vstupy musí být platné. */
export function zonedIso(date: string, time: string, timeZone = DEFAULT_TIMEZONE): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offset = offsetMinutes(naive, timeZone);
  // Okamžik poblíž přechodu letního času: druhý průchod srovná posun.
  const corrected = offsetMinutes(naive - offset * 60000, timeZone);
  if (corrected !== offset) offset = corrected;
  return `${date}T${time}:00${formatOffset(offset)}`;
}

/** Konec dne v pásmu svatby (uzávěrka potvrzení účasti platí celý den). */
export function endOfDayIso(date: string, timeZone = DEFAULT_TIMEZONE): string {
  const offset = zonedIso(date, "23:59", timeZone).slice(19);
  return `${date}T23:59:59${offset}`;
}

/** Dnešní datum `YYYY-MM-DD` v pásmu svatby. */
export function todayIn(now: Date, timeZone = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

/** Přičte dny k datu `YYYY-MM-DD` (kalendářně, bez pásma). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
