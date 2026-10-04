import type { ErrorEvent, NodeOptions } from "@sentry/nextjs";

/** Typ transakce se odvozuje z voleb SDK (balíček `@sentry/core` není přímou závislostí). */
export type TransactionEvent = Parameters<NonNullable<NodeOptions["beforeSendTransaction"]>>[0];

/**
 * Čištění událostí Sentry před odesláním (docs/adr/0007-analytics.md, docs/security-privacy.md kap. 3 a 5.5).
 *
 * Adresy v této aplikaci nesou identifikátory: subdoména je slug páru a cesta `/nahled/<token>` je
 * schopnost (capability) k náhledu nezveřejněného webu. Do Sentry proto nikdy nejde adresa, cesta,
 * query, tělo požadavku, cookies, hlavičky, uživatel ani drobečková navigace. Zůstává typ chyby,
 * zásobník a pojmenování trasy ve tvaru šablony (`/h/tenant/[slug]/[locale]`).
 *
 * Modul nemá závislost na prostředí (běží v prohlížeči, na serveru i v edge) a je pokrytý jednotkovým testem.
 */

const REDACTED = "[odstraněno]";

/** Cesty s tajným segmentem, které se smějí objevit v textu chyby nebo v názvu transakce. */
const PATH_SECRETS: readonly [RegExp, string][] = [
  [/\/nahled\/[^/\s?#"')]+/gi, "/nahled/:token"],
  [/\/(?:en\/)?preview\/[^/\s?#"')]+/gi, "/preview/:token"],
  [/\/media\/[^/\s?#"')]+\/[^/\s?#"')]+/gi, "/media/:id/:width"],
  // osobní odkaz domácnosti (`/p/<kód>`): kód je přístup k jejímu RSVP
  [/\/p\/[0-9a-f]{20}\b/gi, "/p/:code"],
];

/** Adresa (http, https) kdekoli v textu se nahradí zástupným znakem: zahrnuje hostitele (slug) i query. */
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>)]+/gi;

/** Zbaví text adres a tajných segmentů cest. */
export function scrubText(value: string): string {
  let out = value.replace(URL_IN_TEXT, REDACTED);
  for (const [pattern, replacement] of PATH_SECRETS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Název transakce (`GET /nahled/abc123?x=1`, nebo šablona trasy). Query a fragment pryč, tajné
 * segmenty nahrazeny; šablony tras (`[slug]`) projdou beze změny.
 */
export function scrubTransactionName(name: string): string {
  const withoutQuery = name.split(/[?#]/)[0] ?? name;
  return scrubText(withoutQuery);
}

type AnyEvent = ErrorEvent | TransactionEvent;

function scrubCommon<T extends AnyEvent>(event: T): T {
  // Žádná část požadavku (adresa, query, tělo, cookies, hlavičky), uživatel ani IP.
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  delete event.server_name;
  // Rozšíření (`extra`) a štítky mohou nést adresy; štítky nechat jen s hodnotami bez adresy.
  if (event.tags) {
    event.tags = Object.fromEntries(
      Object.entries(event.tags).filter(
        ([, v]) => typeof v !== "string" || !/https?:\/\//i.test(v),
      ),
    );
  }
  if (event.contexts) {
    // `trace.data` a `culture` mohou nést adresu; zbytek (runtime, OS, prohlížeč) je technický.
    const { trace, ...rest } = event.contexts;
    delete rest.culture;
    event.contexts = trace
      ? { ...rest, trace: { ...trace, data: undefined } as typeof trace }
      : rest;
  }
  if (typeof event.transaction === "string") {
    event.transaction = scrubTransactionName(event.transaction);
  }
  if (typeof event.message === "string") event.message = scrubText(event.message);
  return event;
}

/** `beforeSend`: chybové události. */
export function scrubErrorEvent<T extends ErrorEvent>(event: T): T {
  scrubCommon(event);
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === "string") exception.value = scrubText(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) {
      // Zásobník se zachová, vyčistí se jen případná adresa v cestě k souboru.
      if (frame.abs_path) frame.abs_path = scrubText(frame.abs_path);
      delete frame.vars;
    }
  }
  return event;
}

/**
 * `beforeSendTransaction`: transakce (výkon). Spany se zahazují celé: nesou adresy volání (`http.url`,
 * dotazy do databáze). Zůstane název šablony trasy a doba trvání.
 */
export function scrubTransactionEvent<T extends TransactionEvent>(event: T): T {
  scrubCommon(event);
  event.spans = [];
  return event;
}

/**
 * Sentry v prohlížeči smí běžet jen na hostiteli úvodní stránky (`se-vezmou.cz`, případně `www.`).
 * Weby párů, průvodce (`app.`) a administrace (`admin.`) nemají v prohlížeči hosta ani správce žádný
 * skript třetí strany (ADR 0007, docs/security-privacy.md kap. 3 a 5.5).
 */
export function isSentryBrowserHost(hostname: string, siteUrl: string): boolean {
  let siteHost: string;
  try {
    siteHost = new URL(siteUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const bare = siteHost.replace(/^www\./, "");
  return host === bare || host === `www.${bare}`;
}

/**
 * Společné volby `Sentry.init` pro prohlížeč, server i edge. Sentry 11 sbírá údaje podle `dataCollection`
 * (starší `sendDefaultPii` zůstává `false` pro jistotu); vše, co může nést osobní údaje, je vypnuto.
 * `traceLifecycle: "static"` je nutné, jinak Sentry 11 (výchozí `stream`) `beforeSendTransaction` ignoruje
 * a transakce by se čistit nemohly.
 */
export const sentryPrivacyOptions = {
  sendDefaultPii: false,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [] as never[],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  },
  traceLifecycle: "static" as const,
  beforeBreadcrumb: () => null,
  beforeSend: (event: ErrorEvent) => scrubErrorEvent(event),
  beforeSendTransaction: (event: TransactionEvent) => scrubTransactionEvent(event),
};
