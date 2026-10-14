import type { Locale } from "@/i18n/config";
import { slugFromNames, slugProblem } from "@/wizard/slug";

/**
 * Čisté části stránky volné adresy (ADR 0015): tvar adresy, zobrazený hostitel a jména odvozená z adresy.
 * Bez serveru a bez databáze, aby šly testovat jednotkově. Dotaz do databáze je v `free-address-state.ts`.
 */

/**
 * Adresa, na kterou se smí ptát databáze: platný tvar (3 až 63 znaků `a-z0-9` a pomlčky) a ne rezervované
 * slovo ani blokovaný výraz. Cokoli jiného je rovnou 404, bez dotazu a bez zápisu do počítadla požadavků.
 */
export function isFreeAddressCandidate(slug: string): boolean {
  return slugProblem(slug) === null;
}

const DOMAIN_FALLBACK = "se-vezmou.cz";

/**
 * Adresa k zobrazení (`david-and-lil.se-vezmou.cz`). Doména se bere z hostitele požadavku (lokálně
 * `*.localhost:3000`), ale jen když hostitel opravdu začíná slugem a má bezpečný tvar; jinak platí
 * `fallbackDomain`. Do textu se tak nikdy nedostane nic, co by nebylo slug nebo doména.
 */
export function addressHost(
  slug: string,
  host: string | null | undefined,
  fallbackDomain: string = DOMAIN_FALLBACK,
): string {
  const safe = host && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? host.toLowerCase() : null;
  if (safe?.startsWith(`${slug}.`) && safe.length > slug.length + 1) return safe;
  return `${slug}.${fallbackDomain}`;
}

export interface AddressNames {
  first: string;
  second: string;
}

const NAMES_PATTERN = /^([a-z]{2,})-(a|and)-([a-z]{2,})$/;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Jména páru odvozená z adresy, jen když je odvození jednoznačné: právě dvě slova bez pomlček, mezi nimi
 * spojka jazyka stránky (`-a-` česky, `-and-` anglicky). Návrh se ještě ověří opačným směrem: průvodce
 * z jmen s velkým počátečním písmenem musí v tomto jazyce vyrobit přesně tutéž adresu (`slugFromNames`),
 * jinak se nepředvyplní nic. Diakritiku adresa neobsahuje, proto jména vyjdou bez ní; pár je v průvodci upraví.
 */
export function namesFromSlug(slug: string, locale: Locale): AddressNames | null {
  const match = NAMES_PATTERN.exec(slug);
  if (!match) return null;
  const first = capitalize(match[1]);
  const second = capitalize(match[3]);
  return slugFromNames(first, second, locale) === slug ? { first, second } : null;
}
