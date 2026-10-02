import { DEFAULT_TIMEZONE, todayIn } from "@/wizard/zoned";
import type { Phase } from "./types";

/**
 * Fáze webu z dat, pro náhled konceptu (zveřejněný web má fázi z databáze, `app.phase`):
 * potvrzení účasti je otevřené, po uzávěrce zavřené, v den svatby `wedding_day`, po ní `thanks`.
 * Den svatby se počítá v pásmu svatby. Bez data svatby je koncept `rsvp_open`.
 */
export function phaseFromDates(
  input: { startsOn: string; endsOn?: string | null; deadline?: string | null },
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): Phase {
  if (!input.startsOn) return "rsvp_open";
  const today = todayIn(now, timeZone);
  const last = input.endsOn || input.startsOn;
  if (today > last) return "thanks";
  if (today >= input.startsOn) return "wedding_day";
  if (input.deadline && today > input.deadline) return "rsvp_closed";
  return "rsvp_open";
}
