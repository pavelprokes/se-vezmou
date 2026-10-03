import { defaultLocale, locales, type Locale } from "./config";
import {
  ALLOWED_TAGS,
  REQUIRED_PLURAL_CATEGORIES,
  extractPlaceholders,
  extractTags,
  isPluralForms,
  stripTags,
  type MessageValue,
} from "./format";
import { findTypoViolations } from "./typo";

/** Zprávy podle jazyka: `{ cs: { "common.brand": "Se vezmou", ... }, en: { ... } }`. */
export type FlatCatalogs = Record<Locale, Record<string, MessageValue>>;

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

function forms(value: MessageValue): [string, string][] {
  return typeof value === "string"
    ? [["", value]]
    : Object.entries(value).map(([category, text]) => [`.${category}`, text ?? ""]);
}

/**
 * Kontrola překladů a typografie (ADR 0003): parita klíčů, zástupných znaků a značek,
 * množná čísla, typografie zdrojových zpráv a nepoužité klíče (varování). Každý jazyk se porovnává
 * s výchozím jazykem (zdroj pravdy o klíčích).
 */
export function checkMessages(catalogs: FlatCatalogs, usedKeys?: ReadonlySet<string>): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const first = defaultLocale;
  const rest = locales.filter((locale) => locale !== defaultLocale);
  for (const locale of rest) {
    for (const key of Object.keys(catalogs[first])) {
      if (!(key in catalogs[locale])) errors.push(`[${locale}] chybí klíč ${key} (je v ${first})`);
    }
    for (const key of Object.keys(catalogs[locale])) {
      if (!(key in catalogs[first])) errors.push(`[${first}] chybí klíč ${key} (je v ${locale})`);
    }
  }

  for (const locale of locales) {
    for (const [key, value] of Object.entries(catalogs[locale])) {
      if (isPluralForms(value)) {
        for (const category of REQUIRED_PLURAL_CATEGORIES[locale]) {
          if (!value[category]) errors.push(`[${locale}] ${key}: chybí množný tvar "${category}"`);
        }
        const allowed = new Set<string>(REQUIRED_PLURAL_CATEGORIES[locale]);
        for (const category of Object.keys(value)) {
          if (!allowed.has(category)) {
            errors.push(`[${locale}] ${key}: nepoužitelný množný tvar "${category}"`);
          }
        }
      }

      for (const [suffix, text] of forms(value)) {
        const where = `[${locale}] ${key}${suffix}`;
        if (text.trim() === "") {
          errors.push(`${where}: prázdný text`);
          continue;
        }
        for (const tag of new Set(extractTags(text))) {
          if (!(ALLOWED_TAGS as readonly string[]).includes(tag)) {
            errors.push(`${where}: nepovolená značka <${tag}>`);
          }
        }
        for (const problem of findTypoViolations(stripTags(text), locale)) {
          errors.push(`${where}: typografie, ${problem}`);
        }
      }
    }
  }

  // Parita zástupných znaků a značek mezi jazyky (u množných čísel po kategoriích `other`).
  for (const key of Object.keys(catalogs[first])) {
    for (const locale of rest) {
      const a = catalogs[first][key];
      const b = catalogs[locale][key];
      if (b === undefined) continue;
      if (isPluralForms(a) !== isPluralForms(b)) {
        errors.push(`${key}: v ${first} a ${locale} se liší typ (text a množná čísla)`);
        continue;
      }
      const left = typeof a === "string" ? a : (a.other ?? "");
      const right = typeof b === "string" ? b : (b.other ?? "");
      if (extractPlaceholders(left).join() !== extractPlaceholders(right).join()) {
        errors.push(`${key}: zástupné znaky se liší mezi ${first} a ${locale}`);
      }
      if (extractTags(left).join() !== extractTags(right).join()) {
        errors.push(`${key}: značky se liší mezi ${first} a ${locale}`);
      }
    }
  }

  if (usedKeys) {
    for (const key of Object.keys(catalogs[first])) {
      if (!usedKeys.has(key)) warnings.push(`nepoužitý klíč ${key}`);
    }
  }

  return { errors, warnings };
}
