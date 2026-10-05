import type { GuestList } from "@/lib/rsvp/types";

export const nameCardAudiences = ["attending", "all"] as const;
export type NameCardAudience = (typeof nameCardAudiences)[number];

/**
 * Jména na jmenovky: hosté domácností (všichni, nebo jen ti, kdo přijdou aspoň na jednu událost),
 * volitelně jen ze skupiny. Lidé, kteří odpověděli bez pozvánky v seznamu, se přidají, když přijdou
 * (ke skupině nepatří, proto jen bez filtru skupiny). Seřazeno podle abecedy, ať se jmenovky
 * na stole hledají snadno.
 */
export function nameCardNames(
  list: GuestList,
  { audience, group }: { audience: NameCardAudience; group: string | null },
): string[] {
  const names: string[] = [];
  for (const household of list.households) {
    if (group !== null && !household.tags.includes(group)) continue;
    for (const guest of household.guests) {
      if (audience === "attending" && !guest.attendance.some((a) => a.attending)) continue;
      names.push(guest.display_name);
    }
  }
  if (group === null) {
    for (const response of list.unlisted) {
      for (const person of response.people) {
        if (person.attendance.some((a) => a.attending)) names.push(person.person_name);
      }
    }
  }
  return names
    .map((name) => name.normalize("NFC").trim().replace(/\s+/g, " "))
    .filter((name) => name !== "")
    .sort((a, b) => a.localeCompare(b, "cs"));
}
