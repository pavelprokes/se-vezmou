import type { Locale } from "./config";
import type { MessageValue } from "./format";

import csAdmin from "./messages/cs/admin.json";
import csAdminGuests from "./messages/cs/admin.guests.json";
import csAuth from "./messages/cs/auth.json";
import csCatalog from "./messages/cs/catalog.json";
import csCommon from "./messages/cs/common.json";
import csLanding from "./messages/cs/landing.json";
import csLegal from "./messages/cs/legal.json";
import csMarketing from "./messages/cs/marketing.json";
import csOps from "./messages/cs/ops.json";
import csPlaceholder from "./messages/cs/placeholder.json";
import csRsvp from "./messages/cs/rsvp.json";
import enAdmin from "./messages/en/admin.json";
import enAdminGuests from "./messages/en/admin.guests.json";
import enAuth from "./messages/en/auth.json";
import csSite from "./messages/cs/site.json";
import csWizard from "./messages/cs/wizard.json";
import enCatalog from "./messages/en/catalog.json";
import enCommon from "./messages/en/common.json";
import enLanding from "./messages/en/landing.json";
import enLegal from "./messages/en/legal.json";
import enMarketing from "./messages/en/marketing.json";
import enOps from "./messages/en/ops.json";
import enPlaceholder from "./messages/en/placeholder.json";
import enRsvp from "./messages/en/rsvp.json";
import enSite from "./messages/en/site.json";
import enWizard from "./messages/en/wizard.json";

/** Zdrojem pravdy o klíčích je česká verze; angličtina musí mít stejné klíče (kontrola při sestavení). */
const cs = {
  admin: csAdmin,
  "admin.guests": csAdminGuests,
  auth: csAuth,
  catalog: csCatalog,
  common: csCommon,
  landing: csLanding,
  legal: csLegal,
  marketing: csMarketing,
  ops: csOps,
  placeholder: csPlaceholder,
  rsvp: csRsvp,
  site: csSite,
  wizard: csWizard,
} as const;

const en: Record<keyof typeof cs, Record<string, MessageValue>> = {
  admin: enAdmin,
  "admin.guests": enAdminGuests,
  auth: enAuth,
  catalog: enCatalog,
  common: enCommon,
  landing: enLanding,
  legal: enLegal,
  marketing: enMarketing,
  ops: enOps,
  placeholder: enPlaceholder,
  rsvp: enRsvp,
  site: enSite,
  wizard: enWizard,
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
