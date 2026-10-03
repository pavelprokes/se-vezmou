import type { MessageValue } from "./format";

/**
 * Jmenné prostory překladů a typy klíčů (ADR 0003, ADR 0013). Jen typy a seznam jmen: zprávy se
 * nikdy neimportují staticky, načítá je po jmenných prostorech `loadMessages` (`src/i18n/load.ts`).
 *
 * Zdrojem pravdy o klíčích je výchozí jazyk (čeština): typy se odvozují z jejích souborů
 * (`import type` se při sestavení zahodí, nic se nenačte), ostatní jazyky musí mít stejné klíče
 * (`npm run i18n:check`).
 */
import type admin from "./messages/cs/admin.json";
import type adminGuests from "./messages/cs/admin.guests.json";
import type auth from "./messages/cs/auth.json";
import type blog from "./messages/cs/blog.json";
import type catalog from "./messages/cs/catalog.json";
import type common from "./messages/cs/common.json";
import type errors from "./messages/cs/errors.json";
import type landing from "./messages/cs/landing.json";
import type legal from "./messages/cs/legal.json";
import type marketing from "./messages/cs/marketing.json";
import type ops from "./messages/cs/ops.json";
import type placeholder from "./messages/cs/placeholder.json";
import type rsvp from "./messages/cs/rsvp.json";
import type site from "./messages/cs/site.json";
import type wizard from "./messages/cs/wizard.json";

/**
 * Jmenné prostory podle stránek, které je zobrazují:
 *
 * - `common`: sdílený rámec každé stránky (značka, odkaz na obsah, popisek přepínače jazyka),
 * - `errors`: stránka 404 a chyba aplikace,
 * - `marketing` (metadata úvodní stránky), `landing` (sekce úvodní stránky), `legal` (právní stránky),
 *   `blog` (rámec blogu; samotné články jsou v `content/blog`),
 * - `auth` (přihlášení správců), `wizard` (průvodce), `admin` a `admin.guests` (správa),
 * - `site` a `rsvp` (web páru), `ops` (provozní administrace),
 * - `catalog` a `placeholder` (vývojářský katalog a ukázky, mimo produkci).
 */
export const namespaces = [
  "admin",
  "admin.guests",
  "auth",
  "blog",
  "catalog",
  "common",
  "errors",
  "landing",
  "legal",
  "marketing",
  "ops",
  "placeholder",
  "rsvp",
  "site",
  "wizard",
] as const;

export type Namespace = (typeof namespaces)[number];

type CatalogFiles = {
  admin: typeof admin;
  "admin.guests": typeof adminGuests;
  auth: typeof auth;
  blog: typeof blog;
  catalog: typeof catalog;
  common: typeof common;
  errors: typeof errors;
  landing: typeof landing;
  legal: typeof legal;
  marketing: typeof marketing;
  ops: typeof ops;
  placeholder: typeof placeholder;
  rsvp: typeof rsvp;
  site: typeof site;
  wizard: typeof wizard;
};

/** Každý jmenný prostor ze seznamu musí mít typ souboru (jinak chyba „does not exist“). */
type Catalog = { [K in Namespace]: CatalogFiles[K] };

/** Klíče jmenných prostorů `N`: `NamespaceKey<"common">` je `"common.brand" | ...`. */
export type NamespaceKey<N extends Namespace> = {
  [K in N]: `${K}.${keyof Catalog[K] & string}`;
}[N];

/** `common.skipToContent`, `landing.hero.title` ... Neexistující klíč neprojde kontrolou typů. */
export type MessageKey = NamespaceKey<Namespace>;

/** Zprávy jednoho jmenného prostoru (klíč bez jména prostoru -> text nebo tvary množného čísla). */
export type NamespaceMessages = Readonly<Record<string, MessageValue>>;

/** Ploché zprávy pro prohlížeč (`"wizard.step1.title" -> text`), viz `pickMessages`. */
export type FlatMessages = Record<string, MessageValue>;

export function isNamespace(value: string): value is Namespace {
  return (namespaces as readonly string[]).includes(value);
}
