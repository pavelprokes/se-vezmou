import type { SurfaceKey } from "@/site/themes/palettes";
import type { BlockType } from "@/site/types";

/**
 * Čistá logika šablony Eukalyptus (bez JSX): rytmus ploch, velikost jmen a číslování sekcí.
 */

/** Části stránky Eukalyptu: bloky webu a navíc pás odpočtu a patička. */
export type EuPart = BlockType | "countdown" | "footer";

/** Preferovaná plocha každé části (zadání kap. 7). */
export const PREFERRED_TONE: Record<EuPart, SurfaceKey> = {
  hero: "light",
  countdown: "accent",
  program: "deep",
  venue: "light",
  rsvp: "soft",
  gifts: "dark",
  gallery: "paper",
  lodging: "paper",
  dresscode: "soft",
  faq: "light",
  contact: "deep",
  story: "paper",
  footer: "accent",
};

/** Cyklus náhradních ploch, když by se preferovaná shodovala se sousedem. */
export const TONE_CYCLE: readonly SurfaceKey[] = [
  "light",
  "accent",
  "deep",
  "soft",
  "dark",
  "paper",
];

/**
 * Plochy vykreslených částí: každá dostane preferovanou plochu; shoduje-li se s předchozí nebo následující,
 * vezme se další z cyklu, která se neshoduje s žádnou z nich. První (úvod) a poslední (patička) zůstávají,
 * takže žádné dvě sousední sekce nemají stejnou plochu ani po vynechání volitelných bloků.
 */
export function assignTones(parts: readonly EuPart[]): SurfaceKey[] {
  const tones = parts.map((part) => PREFERRED_TONE[part]);
  for (let i = 1; i < tones.length - 1; i++) {
    const prev = tones[i - 1];
    const next = tones[i + 1];
    if (tones[i] !== prev && tones[i] !== next) continue;
    const start = TONE_CYCLE.indexOf(tones[i]);
    for (let step = 1; step <= TONE_CYCLE.length; step++) {
      const candidate = TONE_CYCLE[(start + step) % TONE_CYCLE.length];
      if (candidate !== prev && candidate !== next) {
        tones[i] = candidate;
        break;
      }
    }
  }
  return tones;
}

/** Počet znaků jména bez okrajových mezer (diakritika rozložená na dva znaky se nejdřív složí). */
function chars(value: string): number {
  return [...value.trim().normalize("NFC")].length;
}

/**
 * Velikost jmen v úvodu: krátká jména jsou na širokém displeji v jednom řádku, delší pod sebou (na mobilu
 * vždy pod sebou, druhý řádek s „&“). Vrací počet znaků nejdelšího řádku pro obě rozvržení; CSS z něj
 * spočítá písmo tak, aby se řádek vešel do šířky okna (`--eu-chars`), s horní mezí podle zadání.
 */
export function fitNames(a: string, b: string) {
  const total = chars(a) + chars(b);
  return {
    layout: total <= 14 ? ("inline" as const) : ("stacked" as const),
    /** „Petra & Iva“ v jednom řádku. */
    inlineChars: total + 3,
    /** „Petra“ a „& Iva“ pod sebou (druhý řádek je odsazený zhruba o šířku znaku). */
    stackedChars: Math.max(chars(a), chars(b) + 3),
  };
}

const ROMAN: readonly [number, string][] = [
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/** Římské číslo sekce (1 → I); sekce se číslují podle vykreslených bloků. */
export function roman(value: number): string {
  let rest = value;
  let out = "";
  for (const [n, symbol] of ROMAN) {
    while (rest >= n) {
      out += symbol;
      rest -= n;
    }
  }
  return out;
}
