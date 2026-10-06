import { env } from "@/env";

/** Pevný zdroj (`utm_source`) měření: jedna instalace, jeden pixel (docs/adr/0014). */
const SOURCE = "se-vezmou";

/**
 * Adresa měřicího pixelu pro jednu šablonu, nebo `null` (pixel se pak nevloží).
 *
 * Adresa nese jen pevné popisy šablony (`utm_source`, `utm_medium`, `utm_content`), nikdy nic o příjemci
 * (adresa, jméno, svatba, token, číslo zprávy). Proto `content` musí být pevný slug šablony zapsaný v kódu.
 * `base` je jen pro testy.
 */
export function getEmailPixelUrl(content: string, base: string | undefined = env.UMAMI_PIXEL_URL) {
  if (!base) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  url.search = "";
  url.hash = "";
  url.searchParams.set("utm_source", SOURCE);
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_content", content);
  return url.toString();
}
