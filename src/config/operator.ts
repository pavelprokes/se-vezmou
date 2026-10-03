/**
 * Údaje o provozovateli a kontakt na jednom místě. Provozovatel je doplněný (Pavel Prokeš, svatební
 * fotograf; IČO ověřeno v ARES), kontakt je zatím zástupný text (žádné vymyšlené údaje). Používá je patička, FAQ, právní stránky i strukturovaná data.
 */
export const operator = {
  /** Obchodní jméno a IČO provozovatele. */
  nameAndId: "Pavel Prokeš, IČO 87877601",
  /** Sídlo provozovatele (ARES, 3. 10. 2026). */
  address: "Křižíkova 424/127, Praha 8",
  /** Kontaktní e-mail nebo formulář. */
  contact: "[KONTAKT]",
} as const;

/** Zástupná hodnota se pozná podle hranatých závorek; skutečné údaje je nemají. */
export function isPlaceholder(value: string): boolean {
  return /^\[.*\]$/.test(value.trim());
}
