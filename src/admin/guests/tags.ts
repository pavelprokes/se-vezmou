import type { GuestList } from "@/lib/rsvp/types";
import { GUEST_LIMITS } from "./types";

/**
 * Skupiny hostů (štítky domácností): rozdělení textu z pole na skupiny, seznam skupin svatby a počty
 * pro filtr. Skupiny vidí jen správce. Skupina se porovnává přesně, jako v SQL (`admin_invitations_bulk_tag`;
 * `lower()` v databázi závisí na jejím nastavení). Jednotný zápis drží editor: napsaná skupina, která se od
 * už používané liší jen velikostí písmen, převezme její zápis (`canonicalTags`).
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

/** Skupiny se zápisem už používaných skupin svatby (liší-li se jen velikostí písmen). */
export function canonicalTags(tags: string[], known: string[]): string[] {
  return tags.map((tag) => known.find((k) => key(k) === key(tag)) ?? tag);
}

/** Je pole skupin platné pro uložení (počet a délka jako v databázi)? */
export function tagsValid(tags: string[]): boolean {
  return (
    tags.length <= GUEST_LIMITS.tagsPerHousehold &&
    tags.every((tag) => tag.length <= GUEST_LIMITS.tag)
  );
}

/** Všechny skupiny svatby abecedně, každá jednou. */
export function weddingTags(households: Pick<Household, "tags">[]): string[] {
  return [...new Set(households.flatMap((household) => household.tags))].sort((a, b) =>
    a.localeCompare(b, "cs"),
  );
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
