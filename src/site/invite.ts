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
  content: Pick<PublicContent, "locales" | "defaultLocale" | "blocks">,
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

type ProgramEvent = Pick<PublicContent["events"][number], "id" | "kind" | "rsvpEnabled">;

/**
 * Program pro hosta z osobního odkazu: bez událostí s potvrzováním účasti, na které jeho domácnost pozvaná
 * není (např. hostina jen pro rodinu). Události bez potvrzování vidí všichni. Bez odkazu beze změny.
 */
export function eventsForGuest<T extends ProgramEvent>(
  events: T[],
  invitedEventIds: string[] | null,
): T[] {
  if (invitedEventIds === null) return events;
  const invited = new Set(invitedEventIds.map((id) => id.toLowerCase()));
  return events.filter(
    (event) =>
      !(event.rsvpEnabled ?? event.kind !== "other") || invited.has(event.id.toLowerCase()),
  );
}
