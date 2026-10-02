import type { Locale } from "@/i18n/config";

/**
 * Cesty správy na hostiteli `app.` v jazycích rozhraní: čeština bez předpony, angličtina pod `/en`
 * (proxy předponu odebere a předá jazyk hlavičkou, cesty stránek zůstávají jedny).
 */
export const ADMIN_PATHS = {
  overview: "/",
  site: "/web",
  history: "/web/historie",
  help: "/napoveda",
} as const;

export function appHref(path: string, locale: Locale): string {
  if (locale === "cs") return path;
  return path === "/" ? "/en" : `/en${path}`;
}
