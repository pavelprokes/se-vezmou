import { splitLocalePath, type Locale } from "@/i18n/config";
import { resolveHost, type HostConfig, type HostKind } from "./resolve";

/**
 * Rozhodnutí proxy: co s požadavkem udělat podle hostitele a cesty (ADR 0002).
 * Čistá funkce, aby šla testovat bez Next.js. Neověřuje, zda svatba existuje (žádná DB).
 */

export type RouteDecision =
  | { action: "notFound"; kind: HostKind | null }
  | { action: "passThrough"; kind: HostKind }
  | {
      action: "rewrite";
      kind: HostKind;
      pathname: string;
      /**
       * Jazyk stránky z adresy (ADR 0013): předpona `/<jazyk>`, bez předpony výchozí jazyk. Chybí jen
       * u `robots.txt` a `sitemap.xml`. Proxy ho předá hlavičkou a podle něj případně přesměruje.
       */
      locale?: LocaleRoute;
    };

export interface LocaleRoute {
  /** Jazyk stránky podle adresy. */
  locale: Locale;
  /** Jazyk z předpony adresy; cesta bez předpony má `null` (výchozí jazyk, nikdo ho nezvolil výslovně). */
  pathLocale: Locale | null;
  /** Veřejná cesta bez předpony jazyka (`/en/web` -> `/web`). */
  path: string;
}

/** Veřejné soubory (`/favicon.ico`, `/logo.svg`) se nepřepisují. `robots.txt`, `sitemap.xml` a `llms.txt` ano. */
function isStaticAsset(pathname: string): boolean {
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml" || pathname === "/llms.txt") {
    return false;
  }
  return /\/[^/]+\.[a-z0-9]+$/i.test(pathname);
}

/**
 * `/en/foo` -> jazyk `en` a cesta `/foo`; bez předpony výchozí jazyk. Předpona výchozího jazyka
 * (`/cs/...`) je duplicita a vrací `null` (404); neznámá předpona není jazyk.
 */
function splitLocale(pathname: string): LocaleRoute | null {
  const split = splitLocalePath(pathname);
  if (!split) return null;
  const prefixed = split.path !== pathname;
  return { locale: split.locale, pathLocale: prefixed ? split.locale : null, path: split.path };
}

function join(base: string, rest: string): string {
  return rest === "/" ? base : `${base}${rest}`;
}

export function routeRequest(
  hostHeader: string | null | undefined,
  pathname: string,
  config: HostConfig,
): RouteDecision {
  const resolution = resolveHost(hostHeader, config);

  // Interní prefix zvenku neexistuje, stejná odpověď jako pro neznámou cestu.
  if (pathname === "/h" || pathname.startsWith("/h/")) {
    return {
      action: "notFound",
      kind: resolution.kind === "invalid" ? null : resolution.kind,
    };
  }

  if (resolution.kind === "invalid") return { action: "notFound", kind: null };

  const kind = resolution.kind;
  if (isStaticAsset(pathname)) return { action: "passThrough", kind };

  if (pathname === "/robots.txt") {
    return { action: "rewrite", kind, pathname: `/h/${kind}/robots.txt` };
  }
  if (pathname === "/sitemap.xml" || pathname === "/llms.txt") {
    return kind === "marketing"
      ? { action: "rewrite", kind, pathname: `/h/marketing${pathname}` }
      : { action: "notFound", kind };
  }

  // Všichni hostitelé mají stejné schéma jazyků: výchozí bez předpony, ostatní pod `/<jazyk>`.
  const split = splitLocale(pathname);
  if (!split) return { action: "notFound", kind };

  switch (resolution.kind) {
    case "marketing":
      return {
        action: "rewrite",
        kind,
        pathname: join(`/h/marketing/${split.locale}`, split.path),
        locale: split,
      };
    case "tenant":
      return {
        action: "rewrite",
        kind,
        pathname: join(`/h/tenant/${resolution.slug}/${split.locale}`, split.path),
        locale: split,
      };
    case "app":
    case "admin":
      // Rozhraní správy a provozní administrace: jedny cesty stránek, jazyk se předá hlavičkou.
      return { action: "rewrite", kind, pathname: join(`/h/${kind}`, split.path), locale: split };
  }
}
