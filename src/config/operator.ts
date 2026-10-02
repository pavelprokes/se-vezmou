/**
 * Údaje o provozovateli a kontakt na jednom místě. Dokud je nedodá majitel, jsou to zástupné
 * texty (žádné vymyšlené údaje). Používá je patička, FAQ, právní stránky i strukturovaná data.
 */
export const operator = {
  /** Obchodní jméno a IČO provozovatele. */
  nameAndId: "[PROVOZOVATEL, IČO]",
  /** Kontaktní e-mail nebo formulář. */
  contact: "[KONTAKT]",
} as const;

/** Zástupná hodnota se pozná podle hranatých závorek; skutečné údaje je nemají. */
export function isPlaceholder(value: string): boolean {
  return /^\[.*\]$/.test(value.trim());
}
