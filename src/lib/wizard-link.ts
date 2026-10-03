import { localePath, type Locale } from "@/i18n/config";

/**
 * Odkaz do průvodce (`app.se-vezmou.cz`) s předvyplněnými jmény (FR-LP-5).
 *
 * Smlouva pro průvodce (M5-2): cesta `/vytvorit` v jazyce odkazu (výchozí bez předpony, jinak
 * `/<jazyk>/vytvorit`, ADR 0013), query parametry `jmeno1`, `jmeno2` a `jazyk` (jazyk webu páru).
 * Název cesty i parametrů je jen na tomto místě a formuláře ho berou odsud.
 */
export const WIZARD_PATH = "/vytvorit";
export const WIZARD_PARAMS = { first: "jmeno1", second: "jmeno2", locale: "jazyk" } as const;

/** Nejdelší jméno, které formulář přijme (delší text je nejspíš omyl). */
export const NAME_MAX_LENGTH = 60;

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH);
}

export interface WizardLinkInput {
  appUrl: string;
  locale: Locale;
  first?: string;
  second?: string;
}

/** Cesta průvodce v jazyce rozhraní (`/vytvorit`, `/en/vytvorit`). */
export function wizardPath(locale: Locale): string {
  return localePath(WIZARD_PATH, locale);
}

export function buildWizardUrl({ appUrl, locale, first, second }: WizardLinkInput): string {
  const url = new URL(wizardPath(locale).slice(1), `${appUrl.replace(/\/+$/, "")}/`);
  const names: [string, string][] = [
    [WIZARD_PARAMS.first, clean(first)],
    [WIZARD_PARAMS.second, clean(second)],
  ];
  for (const [key, value] of names) {
    if (value) url.searchParams.set(key, value);
  }
  url.searchParams.set(WIZARD_PARAMS.locale, locale);
  return url.toString();
}
