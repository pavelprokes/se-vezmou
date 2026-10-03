"use client";

import { useEffect, useRef, useState } from "react";
import { geocodeAddressAction } from "@/app/h/app/vytvorit/actions";

/** Hledání až po chvíli bez psaní: Nominatim dovoluje jeden dotaz za sekundu za celou aplikaci. */
const GEOCODE_DELAY_MS = 800;
/** Krátké čekání na společný limit (víc míst najednou) se zkusí znovu, dlouhé (limit IP) ne. */
const RETRY_MAX_SECONDS = 5;
const RETRY_ATTEMPTS = 4;

export type GeocodeStatus = "searching" | "not_found" | "limited" | "error";
export interface GeocodeHit {
  lat: number;
  lng: number;
  label: string;
}

/**
 * Souřadnice adresy pro mapu (průvodce i editor webu). `address = null` znamená nic nehledat (mapa
 * vypnutá, souřadnice už jsou známé, soukromé místo). Nalezené místo předá `onFound`, ostatní výsledky
 * vrací jako stav pro hlášku pod adresou.
 */
export function useGeocode(
  address: string | null,
  onFound: (hit: GeocodeHit) => void,
): GeocodeStatus | null {
  const [result, setResult] = useState<{ address: string; status: GeocodeStatus } | null>(null);
  const found = useRef(onFound);
  useEffect(() => {
    found.current = onFound;
  });

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (let attempt = 1; ; attempt++) {
        // Selhané volání akce (bez sítě, nové nasazení) je chyba, ne věčné „hledáme“.
        const response = await geocodeAddressAction(address).catch(
          () => ({ status: "error" }) as const,
        );
        if (cancelled) return;
        if (response.status === "found") return found.current(response);
        const retry =
          response.status === "limited" &&
          response.retryAfter <= RETRY_MAX_SECONDS &&
          attempt < RETRY_ATTEMPTS;
        if (!retry) return setResult({ address, status: response.status });
        // Rozptyl, aby se souběžná hledání (víc míst ve správě) znovu nesrazila.
        await new Promise((r) => setTimeout(r, response.retryAfter * 1000 + Math.random() * 1500));
        if (cancelled) return;
      }
    }, GEOCODE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [address]);

  if (!address) return null;
  return result?.address === address ? result.status : "searching";
}
