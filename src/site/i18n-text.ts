import { z } from "zod";
import { defaultLocale, locales, type Locale } from "@/i18n/config";

/**
 * Text po jazycích (`i18n_text` z docs/data-model.md, kapitola 9): klíče jen jazyky z `locales`
 * (doména `i18n_text` v databázi je musí povolit, ADR 0013). Chybějící nebo prázdný překlad je
 * v pořádku, vykreslení pak ukáže dostupný jazyk.
 */
const shape = Object.fromEntries(
  locales.map((locale) => [locale, z.string().optional()]),
) as Record<Locale, z.ZodOptional<z.ZodString>>;
export const i18nTextSchema = z.object(shape).strict();

export type I18nText = z.infer<typeof i18nTextSchema>;

function filled(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/**
 * `pick(text, locale, defaultLocale)`: požadovaný jazyk, pak výchozí jazyk svatby, pak libovolný
 * neprázdný. Nikdy nevrací klíč; bez jakéhokoli textu vrací prázdný řetězec a volající prvek vynechá.
 */
export function pick(
  text: I18nText | null | undefined,
  locale: Locale,
  fallbackLocale: Locale = defaultLocale,
): string {
  const resolved = resolvedLocale(text, locale, fallbackLocale);
  return resolved && text ? (text[resolved] ?? "") : "";
}

/** Jazyk, ve kterém se text skutečně zobrazí; `null`, když chybí úplně. */
export function resolvedLocale(
  text: I18nText | null | undefined,
  locale: Locale,
  fallbackLocale: Locale = defaultLocale,
): Locale | null {
  if (!text) return null;
  for (const candidate of [locale, fallbackLocale, ...locales]) {
    if (filled(text[candidate])) return candidate;
  }
  return null;
}

/** Jazyky webu, ve kterých text chybí (podklad pro hlášení správci při publikaci, FR-WEB-2). */
export function missingLocales(
  text: I18nText | null | undefined,
  siteLocales: readonly Locale[],
): Locale[] {
  return siteLocales.filter((locale) => !filled(text?.[locale]));
}
