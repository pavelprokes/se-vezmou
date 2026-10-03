import { Fragment, type ReactNode } from "react";
import { defaultLocale, intlLocale, type Locale } from "./config";
import { parseRich, renderText, selectForm, type MessageValue, type Params } from "./format";
import type { Namespace, NamespaceKey, NamespaceMessages } from "./messages";
import { typo } from "./typo";

export type RichTags = Record<string, (children: ReactNode) => ReactNode>;

/** `t()` nad jmennými prostory `N`; klíč z jiného jmenného prostoru neprojde kontrolou typů. */
export interface Translator<N extends Namespace = Namespace> {
  (key: NamespaceKey<N>, params?: Params): string;
  /** Zpráva s povolenými značkami (`<b>`, `<i>`, `<a>`), které se mapují na komponenty. */
  rich(key: NamespaceKey<N>, tags: RichTags, params?: Params): ReactNode;
  readonly locale: Locale;
}

/** Výsledek `loadMessages` (`src/i18n/load.ts`): zprávy jazyka a náhrada ve výchozím jazyce. */
export interface LoadedMessages<N extends Namespace = Namespace> {
  locale: Locale;
  namespaces: readonly N[];
  messages: Partial<Record<Namespace, NamespaceMessages>>;
  /** Tytéž jmenné prostory ve výchozím jazyce; u výchozího jazyka chybí. */
  fallback?: Partial<Record<Namespace, NamespaceMessages>>;
}

function flatten(source: Partial<Record<Namespace, NamespaceMessages>> | undefined) {
  const flat = new Map<string, MessageValue>();
  for (const [namespace, entries] of Object.entries(source ?? {})) {
    for (const [key, value] of Object.entries(entries ?? {}))
      flat.set(`${namespace}.${key}`, value);
  }
  return flat;
}

/**
 * `t()` z načtených jmenných prostorů. Na serveru se získá přes `getTranslator(locale, [...])`
 * (`src/i18n/load.ts`). Chybějící zprávu najde ve výchozím jazyce (požadovaný jazyk -> výchozí,
 * nikdy jiný). Klíč se uživateli nikdy nezobrazí; chyba se zaloguje bez osobních údajů (jen klíč
 * a jazyk).
 */
export function createTranslator<N extends Namespace>(loaded: LoadedMessages<N>): Translator<N> {
  const { locale } = loaded;
  const own = flatten(loaded.messages);
  const fallback = flatten(loaded.fallback);

  function lookup(key: string): MessageValue {
    const direct = own.get(key);
    if (direct !== undefined) return direct;
    console.error(`[i18n] Chybí překlad ${key} pro jazyk ${locale}`);
    if (locale !== defaultLocale) {
      const value = fallback.get(key);
      if (value !== undefined) return value;
    }
    console.error(`[i18n] Klíč ${key} neexistuje ve výchozím jazyce ${defaultLocale}`);
    return "";
  }

  const t = ((key: NamespaceKey<N>, params?: Params) =>
    renderText(lookup(key), locale, params)) as Translator<N>;

  t.rich = (key, tags, params) => {
    const value = lookup(key);
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
