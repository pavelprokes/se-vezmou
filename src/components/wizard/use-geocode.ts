"use client";

import { useEffect, useRef, useState } from "react";
import { geocodeAddressAction } from "@/app/h/app/vytvorit/actions";

/** Hledání až po chvíli bez psaní: Nominatim dovoluje jeden dotaz za sekundu za celou aplikaci. */
const GEOCODE_DELAY_MS = 800;

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
      const response = await geocodeAddressAction(address);
      if (cancelled) return;
      if (response.status === "found") found.current(response);
      else setResult({ address, status: response.status });
    }, GEOCODE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [address]);

  if (!address) return null;
  return result?.address === address ? result.status : "searching";
}
