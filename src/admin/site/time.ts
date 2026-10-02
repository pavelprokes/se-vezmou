import { zonedIso } from "@/wizard/zoned";

/** Datum a čas události v časovém pásmu svatby (program po hodinách, FR-ADM-1). */
export function isoParts(iso: string, timeZone: string): { date: string; time: string } {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** Opak: datum a čas v pásmu svatby na ISO řetězec s posunem; neúplný vstup je `null`. */
export function joinParts(date: string, time: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  try {
    return zonedIso(date, time, timeZone);
  } catch {
    return null;
  }
}
