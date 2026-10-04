import type { GuestList } from "@/lib/rsvp/types";
import { GUEST_LIMITS } from "./types";

/**
 * Skupiny hostů (štítky domácností): rozdělení textu z pole na skupiny, seznam skupin svatby a počty
 * pro filtr. Skupiny vidí jen správce. Porovnání bez ohledu na velikost písmen, jako v SQL
 * (`tags_from_payload`, `admin_invitations_bulk_tag`).
 */

type Household = GuestList["households"][number];

const key = (tag: string) => tag.toLocaleLowerCase("cs");

/** Text „Rodina nevěsty, Kolegové“ na pole skupin: ořez, sloučení mezer, bez prázdných a duplicit. */
export function splitTags(text: string): string[] {
  const result: string[] = [];
  for (const raw of text.split(",")) {
    const tag = raw.replace(/\s+/g, " ").trim();
    if (tag !== "" && !result.some((t) => key(t) === key(tag))) result.push(tag);
  }
  return result;
}

/** Je pole skupin platné pro uložení (počet a délka jako v databázi)? */
export function tagsValid(tags: string[]): boolean {
  return (
    tags.length <= GUEST_LIMITS.tagsPerHousehold &&
    tags.every((tag) => tag.length <= GUEST_LIMITS.tag)
  );
}

export function hasTag(household: Pick<Household, "tags">, tag: string): boolean {
  return household.tags.some((t) => key(t) === key(tag));
}

/** Všechny skupiny svatby abecedně, každá jednou (první zápis vyhrává). */
export function weddingTags(households: Pick<Household, "tags">[]): string[] {
  const seen = new Map<string, string>();
  for (const household of households) {
    for (const tag of household.tags) if (!seen.has(key(tag))) seen.set(key(tag), tag);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "cs"));
}

export type GuestStats = {
  households: number;
  guests: number;
  attending: number;
  declined: number;
  noResponse: number;
};

/** Počty hostů domácností: přijde (na aspoň jednu událost), nepřijde, neodpověděl. */
export function guestStats(households: Household[]): GuestStats {
  const stats: GuestStats = {
    households: households.length,
    guests: 0,
    attending: 0,
    declined: 0,
    noResponse: 0,
  };
  for (const household of households) {
    for (const guest of household.guests) {
      stats.guests += 1;
      if (guest.attendance.some((a) => a.attending)) stats.attending += 1;
      else if (guest.attendance.length > 0) stats.declined += 1;
      else stats.noResponse += 1;
    }
  }
  return stats;
}
