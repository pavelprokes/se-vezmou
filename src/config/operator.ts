/**
 * Údaje o provozovateli a kontakt na jednom místě. Provozovatel je doplněný (Pavel Prokeš, svatební
 * fotograf; IČO ověřeno v ARES), kontakt je info@se-vezmou.cz (záložní adresa pavel@pavelprokes.cz je jen interní, na webu se neuvádí). Používá je patička, FAQ, právní stránky i strukturovaná data.
 */
export const operator = {
  /** Obchodní jméno a IČO provozovatele (viditelný text). */
  nameAndId: "Pavel Prokeš, IČO 87877601",
  /** Obchodní jméno a IČO zvlášť pro strukturovaná data. */
  legalName: "Pavel Prokeš",
  companyId: "87877601",
  /** Sídlo provozovatele (ARES, 3. 10. 2026). */
  address: "Křižíkova 424/127, Praha 8",
  /** Kontaktní e-mail nebo formulář. */
  contact: "info@se-vezmou.cz",
} as const;

/** Zástupná hodnota se pozná podle hranatých závorek; skutečné údaje je nemají. */
export function isPlaceholder(value: string): boolean {
  return /^\[.*\]$/.test(value.trim());
}
