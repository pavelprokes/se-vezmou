import "server-only";
import { cache } from "react";
import { RATE_RULES } from "@/auth/config";
import { rateKey } from "@/auth/rate-limit";
import { getClientIp } from "@/auth/request";
import { requireEnv } from "@/env";
import { checkSlug } from "@/lib/db/rpc-wizard";
import { isFreeAddressCandidate } from "./free-address";

/**
 * Je adresa volná? (ADR 0015) Volá se až poté, co `getSiteState` vrátil `null`, a jen pro kořenovou stránku.
 *
 * Rozhoduje databázová funkce `check_slug` (tatáž jako živá kontrola v průvodci, takže stránka neříká nic,
 * co by průvodce neřekl): `slug_available` je pravda jen pro adresu bez svatby, bez platné rezervace
 * (i rozpracovaného konceptu), bez vyhrazeného slova a bez vyřazené adresy, která už byla zveřejněná.
 * Omezení počtu požadavků podle IP běží přímo v téže funkci (ADR 0010). Při překročení limitu, při chybě
 * i při čemkoli nejasném je odpověď `false`, tedy stejná 404 jako dnes. Výsledek se nikam neukládá.
 *
 * `cache` z Reactu: metadata a stránka v jednom požadavku sdílejí jeden dotaz a počítá se jen jednou.
 */
export const isAddressFree = cache(async (slug: string): Promise<boolean> => {
  if (!isFreeAddressCandidate(slug)) return false;
  try {
    const rule = RATE_RULES.freeAddressIp;
    const result = await checkSlug(slug, {
      key: rateKey(requireEnv("RATE_LIMIT_SECRET"), "free-address-ip", await getClientIp()),
      limit: rule.limit,
      windowSeconds: rule.windowSeconds,
    });
    return result.available === true;
  } catch {
    // Selhání databáze nebo počítadla: stránka se tváří jako dosud (404), nic se neprozradí.
    console.error("[site] kontrola volné adresy selhala");
    return false;
  }
});
