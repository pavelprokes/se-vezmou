import { Fragment, type ReactNode } from "react";
import { defaultLocale, intlLocale, locales, type Locale } from "./config";
import { parseRich, renderText, selectForm, type MessageValue, type Params } from "./format";
import { catalogs, type MessageKey } from "./messages";
import { typo } from "./typo";

export type RichTags = Record<string, (children: ReactNode) => ReactNode>;

export interface Translator {
  (key: MessageKey, params?: Params): string;
  /** Zpráva s povolenými značkami (`<b>`, `<i>`, `<a>`), které se mapují na komponenty. */
  rich(key: MessageKey, tags: RichTags, params?: Params): ReactNode;
  readonly locale: Locale;
}

/**
 * Najde zprávu v jazyce, jinak v druhém jazyce. Klíč se uživateli nikdy nezobrazí;
 * chyba se zaloguje bez osobních údajů (jen klíč a jazyk).
 */
function lookup(locale: Locale, key: MessageKey): MessageValue {
  const direct = catalogs[locale].get(key);
  if (direct !== undefined) return direct;
  console.error(`[i18n] Chybí překlad ${key} pro jazyk ${locale}`);
  for (const other of locales) {
    if (other === locale) continue;
    const fallback = catalogs[other].get(key);
    if (fallback !== undefined) return fallback;
  }
  console.error(`[i18n] Klíč ${key} neexistuje v žádném jazyce`);
  return "";
}

/** `t()` pro Server Components i klienta: `const t = createTranslator("cs")`. */
export function createTranslator(locale: Locale = defaultLocale): Translator {
  const t = ((key: MessageKey, params?: Params) =>
    renderText(lookup(locale, key), locale, params)) as Translator;

  t.rich = (key, tags, params) => {
    const value = lookup(locale, key);
    const parts = parseRich(selectForm(value, locale, params));
    return parts.map((part, index) => {
      if (typeof part === "string") {
        return <Fragment key={index}>{renderText(part, locale, params)}</Fragment>;
      }
      const text = renderText(part.text, locale, params);
      const render = tags[part.tag];
      return <Fragment key={index}>{render ? render(text) : text}</Fragment>;
    });
  };

  Object.defineProperty(t, "locale", { value: locale, enumerable: true });
  return t;
}

/** Formátování přes `Intl` a typografie (nezlomitelné mezery). */
export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions) {
  return typo(new Intl.NumberFormat(intlLocale[locale], options).format(value), locale);
}

export function formatCurrency(value: number, locale: Locale, currency = "CZK") {
  return typo(
    new Intl.NumberFormat(intlLocale[locale], {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value),
    locale,
  );
}

export function formatDate(
  value: Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "numeric", year: "numeric" },
) {
  return typo(new Intl.DateTimeFormat(intlLocale[locale], options).format(value), locale);
}
