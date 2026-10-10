import { localePath, type Locale } from "@/i18n/config";

/**
 * Cesty správy na hostiteli `app.`: výchozí jazyk bez předpony, ostatní pod `/<jazyk>` (proxy
 * předponu odebere a předá jazyk hlavičkou, cesty stránek zůstávají jedny). Odkazy a přesměrování
 * skládá `appHref` (nebo `localHref` podle jazyka požadavku).
 */
export const ADMIN_PATHS = {
  overview: "/",
  weddings: "/svatby",
  site: "/web",
  history: "/web/historie",
  gallerySign: "/web/cedulka",
  guests: "/hoste",
  guestsImport: "/hoste/import",
  guestCards: "/hoste/karty",
  nameCards: "/hoste/jmenovky",
  responses: "/odpovedi",
  rsvpSettings: "/odpovedi/nastaveni",
  access: "/pristup",
  data: "/data",
  help: "/napoveda",
} as const;

/** Veřejný návod pro páry, jen česky (proto bez předpony jazyka). */
export const GUIDE_PATH = "/navod";

/** Úprava domácnosti; `nova` zakládá novou. */
export function householdPath(id: string): string {
  return `/hoste/domacnost/${id}`;
}

/** Zápis odpovědi domácnosti (host odpověděl telefonem). */
export function responsePath(householdId: string): string {
  return `/odpovedi/${householdId}`;
}

/** Cesta v jazyce `locale` na hostitelích `app.` a `admin.` (`/web` -> `/en/web`). */
export function appHref(path: string, locale: Locale): string {
  return localePath(path, locale);
}
