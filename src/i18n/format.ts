import { intlLocale, type Locale } from "./config";
import { typo } from "./typo";

/**
 * Čistá logika zpráv bez Reactu: množná čísla, interpolace a rozbor povolených značek.
 * Používá ji `t()` i kontrola překladů (`npm run i18n:check`).
 */

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type PluralForms = Partial<Record<PluralCategory, string>>;
export type MessageValue = string | PluralForms;
export type Params = Record<string, string | number>;

/** Povinné množné kategorie podle jazyka (čeština má čtyři tvary). */
export const REQUIRED_PLURAL_CATEGORIES: Record<Locale, readonly PluralCategory[]> = {
  cs: ["one", "few", "many", "other"],
  en: ["one", "other"],
};

/** Značky, které smí zpráva obsahovat (mapují se na komponenty v `t.rich`). */
export const ALLOWED_TAGS = ["a", "b", "i"] as const;

export function isPluralForms(value: unknown): value is PluralForms {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

export function extractTags(text: string): string[] {
  return [...text.matchAll(/<\/?([a-zA-Z][\w-]*)>/g)].map((m) => m[1].toLowerCase()).sort();
}

/** Odstraní povolené značky, aby se text dal kontrolovat jako holý text. */
export function stripTags(text: string): string {
  return text.replace(/<\/?[a-zA-Z][\w-]*>/g, "");
}

/** Vybere tvar zprávy podle `Intl.PluralRules`; chybějící kategorie padá na `other`. */
export function selectForm(value: MessageValue, locale: Locale, params?: Params): string {
  if (typeof value === "string") return value;
  const count = Number(params?.count ?? 0);
  const category = new Intl.PluralRules(locale).select(count) as PluralCategory;
  return value[category] ?? value.other ?? "";
}

/** Čísla se do zprávy vkládají podle jazyka (`1,5` česky, `1.5` anglicky), řetězce beze změny. */
export function interpolate(template: string, params?: Params, locale?: Locale): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined) return "";
    return typeof value === "number" && locale
      ? new Intl.NumberFormat(intlLocale[locale]).format(value)
      : String(value);
  });
}

/** Zpráva po interpolaci a typografii (jediné místo, kde se skládá výstup `t()`). */
export function renderText(value: MessageValue, locale: Locale, params?: Params): string {
  return typo(interpolate(selectForm(value, locale, params), params, locale), locale);
}

export type RichPart = string | { tag: string; text: string };

/**
 * Rozdělí zprávu na text a povolené značky. Značky se nevnořují. Parametry se doplňují
 * až do jednotlivých částí, takže hodnota parametru nikdy nevytvoří značku.
 */
export function parseRich(template: string): RichPart[] {
  const parts: RichPart[] = [];
  const pattern = /<([a-z]+)>([^<]*)<\/\1>/g;
  let last = 0;
  for (const match of template.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(template.slice(last, start));
    parts.push({ tag: match[1], text: match[2] });
    last = start + match[0].length;
  }
  if (last < template.length) parts.push(template.slice(last));
  return parts;
}
