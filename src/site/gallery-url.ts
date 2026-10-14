import { authorProjects } from "@/config/operator";

/**
 * Odkaz na galerii fotografa s parametry UTM. Měříme jen vlastní galerii autora
 * (`photos.svatebni-fotograf-cechy.cz`): tam víme, že parametry nic nerozbijí a kdo je vyhodnocuje.
 * Cizím galeriím (Google Fotky, Rajče, galerie jiného fotografa) adresu neměníme.
 *
 * Kampaň je pevná (`galerie-svatby`), ne adresa webu páru: jména snoubenců do analytiky nepatří.
 * Médium říká, odkud host přišel (cedulka na stole, oznámení, odkaz na webu).
 */

export const galleryUtmMedia = ["qr-cedulka", "qr-oznameni", "web"] as const;
export type GalleryUtmMedium = (typeof galleryUtmMedia)[number];

const OWN_GALLERY_HOSTS: readonly string[] = authorProjects
  .filter((project) => project.key === "photos")
  .map((project) => project.host);

const CAMPAIGN = "galerie-svatby";

/** Je adresa vlastní galerie autora (a proto ji smíme označit UTM)? */
export function isOwnGallery(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && OWN_GALLERY_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Adresa s UTM pro vlastní galerii; jinak beze změny. Parametry, které už v odkazu jsou (pár je
 * vložil sám), se nepřepisují.
 */
export function trackedGalleryUrl(url: string, medium: GalleryUtmMedium): string {
  if (!isOwnGallery(url)) return url;
  const parsed = new URL(url);
  const params: [string, string][] = [
    ["utm_source", "se-vezmou"],
    ["utm_medium", medium],
    ["utm_campaign", CAMPAIGN],
  ];
  for (const [key, value] of params) {
    if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

/** Čitelný tvar adresy pro tisk: bez schématu, parametrů a koncového lomítka. */
export function displayGalleryUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname}${path}`;
  } catch {
    return url;
  }
}
