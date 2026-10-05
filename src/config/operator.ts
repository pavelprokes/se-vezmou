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
  /**
   * Profily značky Se vezmou (Instagram, Facebook, Firmy.cz, LinkedIn…) pro `sameAs` ve strukturovaných
   * datech: jen profily, které opravdu patří značce, ne weby autora. Prázdné = `sameAs` se nepíše.
   */
  profiles: [] as readonly string[],
};

/** Zástupná hodnota se pozná podle hranatých závorek; skutečné údaje je nemají. */
export function isPlaceholder(value: string): boolean {
  return /^\[.*\]$/.test(value.trim());
}

/** Další projekty autora: patička webu, sekce „O autorovi“ a patička každého e-mailu. */
export const authorProjects = [
  { key: "site", host: "svatebni-fotograf-cechy.cz" },
  { key: "photos", host: "photos.svatebni-fotograf-cechy.cz" },
] as const;

/** Adresa projektu s UTM značkami (zdroj `se-vezmou`, médium a kampaň podle místa odkazu). */
export function projectUrl(host: string, medium: string, campaign: string): string {
  const params = new URLSearchParams({
    utm_source: "se-vezmou",
    utm_medium: medium,
    utm_campaign: campaign,
  });
  return `https://${host}/?${params.toString()}`;
}
