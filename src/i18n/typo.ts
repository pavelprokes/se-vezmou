import type { Locale } from "./config";

/**
 * Česká (a základní anglická) typografie podle ADR 0003.
 *
 * Čistá, idempotentní funkce bez I/O. Pracuje jen s textem, nikdy ne se značkami nebo
 * atributy HTML, takže se volá na jednotlivé textové uzly (i uvnitř `t.rich`).
 * Uvozovky záměrně nehádá: zdrojové zprávy musí obsahovat správné znaky a hlídá je
 * `npm run i18n:check`.
 */

export const NBSP = " ";

/** Jednotky, před kterými stojí nezlomitelná mezera (konfigurovatelné pro typografa). */
export const UNITS: Record<Locale, readonly string[]> = {
  cs: [
    ...["Kč", "EUR", "€", "%", "°C"],
    ...["host", "hosté", "hosta", "hostů", "osoba", "osoby", "osob"],
    ...[
      "den",
      "dny",
      "dní",
      "dnů",
      "hodina",
      "hodiny",
      "hodin",
      "minuta",
      "minuty",
      "minut",
      "min",
    ],
    ...["týden", "týdny", "týdnů", "měsíc", "měsíce", "měsíců", "rok", "roky", "roků", "let"],
    ...["km", "m", "cm", "mm", "kg", "g", "l", "ml", "MB", "GB"],
  ],
  en: [
    ...["GBP", "CZK", "EUR", "£", "€", "%", "°C"],
    ...["guest", "guests", "person", "people"],
    ...["day", "days", "hour", "hours", "minute", "minutes", "min"],
    ...["week", "weeks", "month", "months", "year", "years"],
    ...["km", "m", "cm", "mm", "kg", "g", "l", "ml", "MB", "GB"],
  ],
};

const CS_MONTHS_GENITIVE = [
  "ledna",
  "února",
  "března",
  "dubna",
  "května",
  "června",
  "července",
  "srpna",
  "září",
  "října",
  "listopadu",
  "prosince",
];

const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unitSource(locale: Locale): string {
  // Delší jednotky první, aby `hostů` nepřebilo `host`.
  const alternatives = [...UNITS[locale]]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return `(\\d) (?=(?:${alternatives})(?![\\p{L}\\p{N}]))`;
}

const unitSources: Record<Locale, string> = { cs: unitSource("cs"), en: unitSource("en") };

export function typo(text: string, locale: Locale): string {
  let out = text;

  // Tři tečky jako jeden znak.
  out = out.replace(/(?<!\.)\.{3}(?!\.)/g, "…");

  // Myšlenková pauza: " - " na " – ", před pomlčkou nezlomitelná mezera.
  out = out.replace(/ [-–] /g, `${NBSP}– `);

  // Číslo a jednotka nebo měna (`990 Kč`, `60 hostů`).
  out = out.replace(new RegExp(unitSources[locale], "gu"), `$1${NBSP}`);

  // Tisíce (`12 000`): jen když číslo nenavazuje na tečku nebo čárku (datum, desetinné číslo).
  out = out.replace(/(?<![\d.,])(\d{1,3}) (?=\d{3}(?!\d))/g, `$1${NBSP}`);

  if (locale === "cs") {
    // Jednopísmenné předložky a spojky (k, s, v, z, o, u, a, i).
    out = out.replace(/(?<![\p{L}\p{N}])([KkSsVvZzOoUuAaIi]) /gu, `$1${NBSP}`);

    // Datum: `1. 10. 2026`, `1. 10.` a `1. října`.
    out = out.replace(/(\d{1,2})\. (?=\d{1,2}\.)/g, `$1.${NBSP}`);
    out = out.replace(/(\d{1,2}\.) (?=\d{4}(?!\d))/g, `$1${NBSP}`);
    out = out.replace(
      new RegExp(`(\\d{1,2})\\. (?=(?:${CS_MONTHS_GENITIVE.join("|")})(?![\\p{L}]))`, "gu"),
      `$1.${NBSP}`,
    );
  } else {
    // Britská angličtina: `1 October 2026`.
    out = out.replace(new RegExp(`(\\d{1,2}) (?=(?:${EN_MONTHS.join("|")})\\b)`, "g"), `$1${NBSP}`);
  }

  return out;
}

/**
 * Najde porušení pravidel, která `typo()` neopraví nebo po opravě zůstala.
 * Používá je kontrola překladů; ASCII uvozovky nejdou opravit automaticky.
 */
export function findTypoViolations(text: string, locale: Locale): string[] {
  const fixed = typo(text, locale);
  const problems: string[] = [];
  if (fixed.includes('"')) problems.push('rovná uvozovka (")');
  if (fixed.includes("'")) problems.push("rovný apostrof (')");
  if (/\.{3}/.test(fixed)) problems.push("tři tečky místo …");
  if (typo(fixed, locale) !== fixed) problems.push("typo() není idempotentní");
  if (locale === "cs" && /(?<![\p{L}\p{N}])[KkSsVvZzOoUuAaIi] /u.test(fixed)) {
    problems.push("jednopísmenná předložka před běžnou mezerou");
  }
  if (new RegExp(unitSources[locale], "u").test(fixed)) {
    problems.push("číslo a jednotka s běžnou mezerou");
  }
  return problems;
}
