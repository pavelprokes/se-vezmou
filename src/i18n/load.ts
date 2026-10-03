import "server-only";
import { cache } from "react";
import { defaultLocale, type Locale } from "./config";
import { isNamespace, type FlatMessages, type Namespace, type NamespaceMessages } from "./messages";
import { createTranslator, type LoadedMessages, type Translator } from "./translator";

/**
 * Načítání překladů po jmenných prostorech (ADR 0013). Jediné místo, které zprávy importuje:
 * každý soubor je samostatný líný chunk, takže stránka a její bundle nesou jen to, co si vyžádá.
 * Tabulka je výslovná (jazyk × jmenný prostor), aby bundler i sledování souborů na Vercelu
 * cesty vyřešily staticky; `Record<Locale, Record<Namespace, ...>>` vynutí úplnost po přidání
 * jazyka nebo jmenného prostoru.
 */
type Loader = () => Promise<{ default: NamespaceMessages }>;

export const loaders: Record<Locale, Record<Namespace, Loader>> = {
  cs: {
    admin: () => import("./messages/cs/admin.json"),
    "admin.guests": () => import("./messages/cs/admin.guests.json"),
    auth: () => import("./messages/cs/auth.json"),
    blog: () => import("./messages/cs/blog.json"),
    catalog: () => import("./messages/cs/catalog.json"),
    common: () => import("./messages/cs/common.json"),
    errors: () => import("./messages/cs/errors.json"),
    landing: () => import("./messages/cs/landing.json"),
    legal: () => import("./messages/cs/legal.json"),
    marketing: () => import("./messages/cs/marketing.json"),
    ops: () => import("./messages/cs/ops.json"),
    placeholder: () => import("./messages/cs/placeholder.json"),
    rsvp: () => import("./messages/cs/rsvp.json"),
    site: () => import("./messages/cs/site.json"),
    wizard: () => import("./messages/cs/wizard.json"),
  },
  en: {
    admin: () => import("./messages/en/admin.json"),
    "admin.guests": () => import("./messages/en/admin.guests.json"),
    auth: () => import("./messages/en/auth.json"),
    blog: () => import("./messages/en/blog.json"),
    catalog: () => import("./messages/en/catalog.json"),
    common: () => import("./messages/en/common.json"),
    errors: () => import("./messages/en/errors.json"),
    landing: () => import("./messages/en/landing.json"),
    legal: () => import("./messages/en/legal.json"),
    marketing: () => import("./messages/en/marketing.json"),
    ops: () => import("./messages/en/ops.json"),
    placeholder: () => import("./messages/en/placeholder.json"),
    rsvp: () => import("./messages/en/rsvp.json"),
    site: () => import("./messages/en/site.json"),
    wizard: () => import("./messages/en/wizard.json"),
  },
};

/** Jeden jmenný prostor v jednom jazyce, jednou za požadavek (React `cache`). */
const loadNamespace = cache(async (locale: Locale, namespace: Namespace) => {
  const loader = loaders[locale]?.[namespace];
  if (!loader) throw new Error(`[i18n] Neznámý jazyk ${locale} nebo jmenný prostor ${namespace}`);
  return (await loader()).default;
});

function assertNamespaces(list: readonly string[]): asserts list is readonly Namespace[] {
  for (const namespace of list) {
    if (!isNamespace(namespace)) {
      throw new Error(`[i18n] Neznámý jmenný prostor „${namespace}“ (src/i18n/messages.ts)`);
    }
  }
}

async function loadFor(
  locale: Locale,
  list: readonly Namespace[],
): Promise<Partial<Record<Namespace, NamespaceMessages>>> {
  const entries = await Promise.all(
    list.map(async (namespace) => [namespace, await loadNamespace(locale, namespace)] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * Zprávy jmenných prostorů `namespaces` v jazyce `locale` a jako náhrada tytéž jmenné prostory
 * ve výchozím jazyce (jen pokud se `locale` liší). Nic jiného se nenačte.
 */
export async function loadMessages<N extends Namespace>(
  locale: Locale,
  namespaces: readonly N[],
): Promise<LoadedMessages<N>> {
  assertNamespaces(namespaces);
  const unique = [...new Set(namespaces)];
  const [messages, fallback] = await Promise.all([
    loadFor(locale, unique),
    locale === defaultLocale ? Promise.resolve(undefined) : loadFor(defaultLocale, unique),
  ]);
  return { locale, namespaces: unique, messages, fallback };
}

/**
 * `t()` pro Server Components: `const t = await getTranslator(locale, ["common", "auth"])`.
 * Klíč mimo vyjmenované jmenné prostory neprojde kontrolou typů.
 */
export async function getTranslator<N extends Namespace>(
  locale: Locale,
  namespaces: readonly N[],
): Promise<Translator<N>> {
  return createTranslator(await loadMessages(locale, namespaces));
}

/**
 * Ploché zprávy pro klientské komponenty (`"wizard.step1.title" -> text`): jen vyjmenované jmenné
 * prostory, chybějící překlad doplněný z výchozího jazyka (a zalogovaný). Klientská komponenta
 * katalogy nikdy neimportuje, dostane jen tento objekt jako vlastnost.
 */
export async function pickMessages(
  locale: Locale,
  namespaces: readonly Namespace[],
): Promise<FlatMessages> {
  const loaded = await loadMessages(locale, namespaces);
  const out: FlatMessages = {};
  for (const namespace of loaded.namespaces) {
    const own = loaded.messages[namespace] ?? {};
    const fallback = loaded.fallback?.[namespace] ?? {};
    for (const [key, value] of Object.entries(fallback)) {
      if (!(key in own)) {
        console.error(`[i18n] Chybí překlad ${namespace}.${key} pro jazyk ${locale}`);
        out[`${namespace}.${key}`] = value;
      }
    }
    for (const [key, value] of Object.entries(own)) out[`${namespace}.${key}`] = value;
  }
  return out;
}
