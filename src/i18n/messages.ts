import type { Locale } from "./config";
import type { MessageValue } from "./format";

import csCatalog from "./messages/cs/catalog.json";
import csCommon from "./messages/cs/common.json";
import csLanding from "./messages/cs/landing.json";
import csLegal from "./messages/cs/legal.json";
import csMarketing from "./messages/cs/marketing.json";
import csPlaceholder from "./messages/cs/placeholder.json";
import enCatalog from "./messages/en/catalog.json";
import enCommon from "./messages/en/common.json";
import enLanding from "./messages/en/landing.json";
import enLegal from "./messages/en/legal.json";
import enMarketing from "./messages/en/marketing.json";
import enPlaceholder from "./messages/en/placeholder.json";

/** Zdrojem pravdy o klíčích je česká verze; angličtina musí mít stejné klíče (kontrola při sestavení). */
const cs = {
  catalog: csCatalog,
  common: csCommon,
  landing: csLanding,
  legal: csLegal,
  marketing: csMarketing,
  placeholder: csPlaceholder,
} as const;

const en: Record<keyof typeof cs, Record<string, MessageValue>> = {
  catalog: enCatalog,
  common: enCommon,
  landing: enLanding,
  legal: enLegal,
  marketing: enMarketing,
  placeholder: enPlaceholder,
};

type Namespaces = typeof cs;

/** `common.skipToContent`, `landing.hero.title` ... Neexistující klíč neprojde kontrolou typů. */
export type MessageKey = {
  [N in keyof Namespaces & string]: `${N}.${keyof Namespaces[N] & string}`;
}[keyof Namespaces & string];

function flatten(source: Record<string, Record<string, MessageValue>>): Map<string, MessageValue> {
  const flat = new Map<string, MessageValue>();
  for (const [namespace, entries] of Object.entries(source)) {
    for (const [key, value] of Object.entries(entries)) {
      flat.set(`${namespace}.${key}`, value);
    }
  }
  return flat;
}

export const catalogs: Record<Locale, Map<string, MessageValue>> = {
  cs: flatten(cs),
  en: flatten(en),
};
