import { isLocale, type Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/pathnames";
import type { PublicContent } from "./types";

/**
 * Osobní odkaz domácnosti na web páru (`/p/<kód>`, QR na pozvánce). Čistý modul: cesta odkazu, kam
 * přesměrovat po otevření a jaký program host uvidí.
 */

/** Cesta osobního odkazu bez jazyka; jazyk webu vybere přesměrování podle hosta. */
export function invitePath(code: string): string {
  return `/p/${code}`;
}

/** Kam po otevření odkazu: jazyk hosta, když ho web nabízí, jinak jazyk adresy, jinak výchozí; kotva RSVP. */
export function inviteTarget(
  content: Pick<PublicContent, "locales" | "defaultLocale"> & {
    blocks: Pick<PublicContent["blocks"][number], "type" | "enabled" | "anchor">[];
  },
  guestLocale: string | null,
  urlLocale: Locale,
): string {
  const offered = (l: string | null): l is Locale =>
    l !== null && isLocale(l) && content.locales.includes(l);
  const locale = offered(guestLocale)
    ? guestLocale
    : offered(urlLocale)
      ? urlLocale
      : content.defaultLocale;
  const rsvp = content.blocks.find((block) => block.type === "rsvp" && block.enabled);
  return `${localizedPath("home", locale)}${rsvp ? `#${rsvp.anchor}` : ""}`;
}

/**
 * Program pro hosta z osobního odkazu: bez událostí s potvrzováním účasti (podle databáze, stejně jako
 * formulář), na které jeho domácnost pozvaná není (např. hostina jen pro rodinu). Ostatní události vidí
 * všichni. Bez odkazu beze změny.
 */
export function eventsForGuest<T extends { id: string }>(
  events: T[],
  invite: { invited: string[]; rsvp: string[] } | null,
): T[] {
  if (invite === null) return events;
  const invited = new Set(invite.invited.map((id) => id.toLowerCase()));
  const rsvp = new Set(invite.rsvp.map((id) => id.toLowerCase()));
  return events.filter((event) => {
    const id = event.id.toLowerCase();
    return !rsvp.has(id) || invited.has(id);
  });
}
