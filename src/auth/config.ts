/**
 * Lhůty a limity přihlášení na jednom místě (docs/adr/0010-rate-limiting.md: "limity jsou
 * konfigurace v jednom souboru, ne rozseté konstanty"). Hodnoty jsou výchozí návrh k ladění po betě.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Relace správce (docs/security-privacy.md kap. 1.3): nečinnost 14 dní, absolutně 60 dní. */
export const ADMIN_SESSION = {
  idleSeconds: 14 * DAY,
  absoluteSeconds: 60 * DAY,
} as const;

/** Jednorázový kód a odkaz: platnost 10 minut, po pěti chybách se výzva zneplatní (v databázi). */
export const LOGIN_CODE = {
  ttlSeconds: 10 * MINUTE,
  length: 6,
  maxAttempts: 5,
} as const;

export interface RateRule {
  /** Povolený počet požadavků v okně. */
  limit: number;
  windowSeconds: number;
}

/** Omezení počtu požadavků (ADR 0010, tabulka limitů). Klíče jsou HMAC, viz `rate-limit.ts`. */
export const RATE_RULES = {
  /** Vyžádání kódu podle e-mailu: při překročení stejná odpověď, kód se neposílá. */
  loginRequestEmail: { limit: 5, windowSeconds: HOUR },
  /** Vyžádání kódu podle IP. */
  loginRequestIp: { limit: 20, windowSeconds: HOUR },
  /** Ověření kódu podle IP. */
  loginVerifyIp: { limit: 30, windowSeconds: HOUR },
  /** PIN správy podle IP (počítají se všechny pokusy, úspěšné přihlášení PINem je řídké). */
  pinAdminIp: { limit: 20, windowSeconds: HOUR },
  /** PIN hostů podle svatby a IP (hosté na jedné Wi-Fi: volnější než PIN správy). */
  pinGuestIp: { limit: 60, windowSeconds: HOUR },
  /** PIN hostů: součet chyb za všechny IP jedné svatby. */
  pinGuestWeddingFailures: { limit: 50, windowSeconds: HOUR },
  /** Čekací listina (úvodní stránka) podle IP; stejná odpověď i po překročení kvůli opakovanému e-mailu. */
  waitlistIp: { limit: 10, windowSeconds: HOUR },
  /** Živá kontrola adresy v průvodci podle IP (informativní, přísná, bez prozrazení; FR-WZ-4). */
  slugCheckIp: { limit: 60, windowSeconds: 10 * MINUTE },
  /** Hledání souřadnic adresy pro mapu (průvodce i správa) podle IP; volá Nominatim, proto přísně. */
  geocodeIp: { limit: 30, windowSeconds: 10 * MINUTE },
  /** Nominatim dovoluje nejvýš jeden dotaz za sekundu za celou aplikaci (pravidla OSMF). */
  nominatimGlobal: { limit: 1, windowSeconds: 1 },
  /** Dlaždice mapy z `/api/map-tile` podle IP; počítají se jen dotazy mimo mezipaměť CDN. Jedna stránka ≈ 30 dlaždic. */
  mapTileIp: { limit: 1000, windowSeconds: 10 * MINUTE },
  /** Vyžádání kódu při prvním uložení v průvodci podle IP a podle e-mailu. */
  wizardCodeIp: { limit: 10, windowSeconds: HOUR },
  wizardCodeEmail: { limit: 5, windowSeconds: HOUR },
  /** Ověření kódu při prvním uložení podle IP. */
  wizardVerifyIp: { limit: 30, windowSeconds: HOUR },
  /** PDF oznámení s PINem podle svatby: každé stažení ověřuje PIN (argon2id), proto omezeně. */
  announcementPdfWedding: { limit: 30, windowSeconds: HOUR },
  /** Vytvoření konceptu (první uložení) podle IP; chrání před hromaděním rezervací adres. */
  wizardCreateIp: { limit: 10, windowSeconds: DAY },
  /** Průběžné ukládání a zveřejnění podle svatby (autosave je častý, ale ne neomezený). */
  wizardSaveWedding: { limit: 600, windowSeconds: HOUR },
  /** Měřicí události průvodce podle IP (bez osobních údajů, zahazují se tiše). */
  wizardEventIp: { limit: 200, windowSeconds: HOUR },
  /** RSVP, slepé porovnání jména podle svatby a IP (při překročení stejná odpověď jako neshoda). */
  rsvpMatch: { limit: 15, windowSeconds: HOUR },
  /** RSVP, odeslání podle svatby a IP (hosté na jedné Wi-Fi: limit IP je volnější než u přihlášení). */
  rsvpSubmitIp: { limit: 10, windowSeconds: HOUR },
  /** RSVP, odeslání za celou svatbu (součet všech IP). */
  rsvpSubmitWedding: { limit: 200, windowSeconds: HOUR },
  /** RSVP, upozornění páru e-mailem za celou svatbu (pojistka proti záplavě zpráv; nad limit se upozornění přeskočí). */
  rsvpNotifyWedding: { limit: 30, windowSeconds: HOUR },
  /** Správa webu (M7a): průběžné ukládání konceptu podle svatby (autosave je častý, ale ne neomezený). */
  siteSaveWedding: { limit: 1500, windowSeconds: HOUR },
  /** Správa webu: zveřejnění, stažení, body pro vrácení a vrácení verze podle svatby. */
  siteVersionWedding: { limit: 60, windowSeconds: HOUR },
  /** Správa webu: načtení náhledu externí galerie (stahuje cizí stránku) podle svatby. */
  galleryCardWedding: { limit: 20, windowSeconds: HOUR },
  /** Fotografie (M7c): žádosti o nahrání (podepsaná adresa pro PUT) podle svatby. Kvótu 12 fotografií hlídá databáze. */
  mediaUploadWedding: { limit: 60, windowSeconds: HOUR },
  /** Fotografie: zpracování nahraného originálu (sharp, nejdražší operace) podle svatby. */
  mediaProcessWedding: { limit: 60, windowSeconds: HOUR },
  /** Fotografie: úprava popisků, mazání a řazení podle svatby. */
  mediaEditWedding: { limit: 600, windowSeconds: HOUR },
  /** Fotografie: odkazy ke stažení všech fotografií (export) podle svatby. */
  mediaExportWedding: { limit: 20, windowSeconds: HOUR },
  /** Správa hostů (M7b): zápisy domácností, pozvání a nastavení RSVP podle svatby. */
  guestsWriteWedding: { limit: 1000, windowSeconds: HOUR },
  /** Import seznamu hostů (čtení a rozbalování cizího souboru je drahé) podle svatby. */
  guestsImportWedding: { limit: 30, windowSeconds: HOUR },
  /** Přístup (M7b): správci, záložní e-mail, PIN, souhlas s nahlédnutím, smazání webu podle svatby. */
  accessChangeWedding: { limit: 60, windowSeconds: HOUR },
  /** Export hostů a RSVP podle svatby. */
  exportWedding: { limit: 30, windowSeconds: HOUR },
} as const satisfies Record<string, RateRule>;

/**
 * Pauzy po chybách PINu: 5 chyb, pauza 15 minut, každá další série dvojnásobná, strop 24 hodin
 * (`[OTÁZKA]` pro majitele). Rozhoduje databáze (`auth_lockout_failure`); `pauseSeconds` je
 * stejný výpočet pro popisy a testy.
 */
export const PIN_LOCKOUT = {
  threshold: 5,
  baseSeconds: 15 * MINUTE,
  maxSeconds: DAY,
} as const;

export function pauseSeconds(level: number, lockout = PIN_LOCKOUT): number {
  if (!Number.isInteger(level) || level < 1) return 0;
  return Math.min(lockout.maxSeconds, lockout.baseSeconds * 2 ** Math.min(level - 1, 30));
}

/**
 * Relace hosta po PINu (docs/adr/0002, docs/security-privacy.md kap. 1.3): kratší než u správce,
 * protože PIN je na tištěném oznámení a jde zadat znovu. Nečinnost 6 hodin, absolutně 2 dny
 * (`[OTÁZKA]`, OQ-41). Odemyká jen citlivé bloky webu, nikdy správu.
 */
export const GUEST_SESSION = {
  idleSeconds: 6 * HOUR,
  absoluteSeconds: 2 * DAY,
} as const;

/**
 * Lístek RSVP v cookie hosta: stejně dlouhý jako lístek v databázi (`rsvp_match`, 30 minut), pak se
 * host znovu ověří jménem. Neprodlužuje se, takže cookie nikdy nedrží přístup k odpovědi déle.
 */
export const RSVP_TICKET_SECONDS = 30 * MINUTE;
/** Cookie s kódem osobního odkazu: host se vrací na web i měsíce po otevření pozvánky. */
export const INVITE_COOKIE_SECONDS = 180 * DAY;

/** PIN: nejméně šest číslic (docs/security-privacy.md kap. 1.2). */
export const PIN_LENGTH = { min: 6, max: 12 } as const;

/** Rozpracované přihlášení v prohlížeči (e-mail po vyžádání kódu), stejná platnost jako kód. */
export const PENDING_LOGIN_SECONDS = LOGIN_CODE.ttlSeconds;
