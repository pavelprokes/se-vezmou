import type { Locale } from "@/i18n/config";

/**
 * Cesty správy na hostiteli `app.` v jazycích rozhraní: čeština bez předpony, angličtina pod `/en`
 * (proxy předponu odebere a předá jazyk hlavičkou, cesty stránek zůstávají jedny).
 */
export const ADMIN_PATHS = {
  overview: "/",
  site: "/web",
  history: "/web/historie",
  guests: "/hoste",
  guestsImport: "/hoste/import",
  responses: "/odpovedi",
  rsvpSettings: "/odpovedi/nastaveni",
  access: "/pristup",
  data: "/data",
  help: "/napoveda",
} as const;

/** Úprava domácnosti; `nova` zakládá novou. */
export function householdPath(id: string): string {
  return `/hoste/domacnost/${id}`;
}

/** Zápis odpovědi domácnosti (host odpověděl telefonem). */
export function responsePath(householdId: string): string {
  return `/odpovedi/${householdId}`;
}

export function appHref(path: string, locale: Locale): string {
  if (locale === "cs") return path;
  return path === "/" ? "/en" : `/en${path}`;
}
