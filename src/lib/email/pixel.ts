import { env } from "@/env";

/** Pevný zdroj (`utm_source`) měření: jedna instalace, jeden pixel (docs/adr/0014). */
const SOURCE = "se-vezmou";

/**
 * Jediné zprávy, které smějí nést pixel (ADR 0014): vypršení webu a jeho trvalé smazání. Oznámení o zdravotních
 * a hostových údajích, kódy, bezpečnostní oznámení a e-maily hostům v seznamu nejsou, tedy pixel nemají.
 */
const ALLOWED = {
  retention: { site_expiry: "smazani-upozorneni" },
  deletion: { site_purge: "smazani-potvrzeni" },
} as const;

/**
 * Sestaví adresu pixelu z nastavené adresy (`base`), nebo `null` (pixel se pak nevloží). Nese jen pevné popisy
 * šablony (`utm_source`, `utm_medium`, `utm_content`), nikdy nic o příjemci (adresa, jméno, svatba, token,
 * číslo zprávy); cizí parametry, fragment a přihlašovací údaje z `base` se zahodí.
 */
export function buildPixelUrl(base: string | undefined, content: string): string | null {
  if (!base) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.searchParams.set("utm_source", SOURCE);
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_content", content);
  return url.toString();
}

/** Pixel pro oznámení daného druhu; `null`, když druh pixel nesmí nést nebo není nastavena `UMAMI_PIXEL_URL`. */
export function noticePixelUrl(notice: keyof typeof ALLOWED, kind: string): string | null {
  const allowed: Record<string, string> = ALLOWED[notice];
  const content = allowed[kind];
  return content ? buildPixelUrl(env.UMAMI_PIXEL_URL, content) : null;
}
