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
       * Jazyk rozhraní na hostiteli `app.`: předpona `/en` (cesta se přepíše bez ní), jinak čeština.
       * Určuje ho vždy cesta, nikdy `Accept-Language`.
       */
      uiLocale?: "cs" | "en";
    };

/** Veřejné soubory (`/favicon.ico`, `/logo.svg`) se nepřepisují. `robots.txt` a `sitemap.xml` ano. */
function isStaticAsset(pathname: string): boolean {
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return false;
  return /\/[^/]+\.[a-z0-9]+$/i.test(pathname);
}

/** `/en/foo` -> `{ locale: "en", rest: "/foo" }`; `/cs/...` je duplicita a vrací `null`. */
function splitLocale(pathname: string): { locale: "cs" | "en"; rest: string } | null {
  const match = /^\/(cs|en)(\/.*)?$/.exec(pathname);
  if (!match) return { locale: "cs", rest: pathname };
  if (match[1] === "cs") return null;
  return { locale: "en", rest: match[2] ?? "/" };
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
  if (pathname === "/sitemap.xml") {
    return kind === "marketing"
      ? { action: "rewrite", kind, pathname: "/h/marketing/sitemap.xml" }
      : { action: "notFound", kind };
  }

  switch (resolution.kind) {
    case "marketing": {
      const split = splitLocale(pathname);
      if (!split) return { action: "notFound", kind };
      return {
        action: "rewrite",
        kind,
        pathname: join(`/h/marketing/${split.locale}`, split.rest),
      };
    }
    case "tenant": {
      const split = splitLocale(pathname);
      if (!split) return { action: "notFound", kind };
      return {
        action: "rewrite",
        kind,
        pathname: join(`/h/tenant/${resolution.slug}/${split.locale}`, split.rest),
      };
    }
    case "app": {
      // Rozhraní správy je česky, anglická varianta stejných stránek je pod `/en` (jazyk rozhraní
      // se pak předá hlavičkou, cesty zůstávají jedny). `/cs/...` je duplicita.
      const split = splitLocale(pathname);
      if (!split) return { action: "notFound", kind };
      return {
        action: "rewrite",
        kind,
        pathname: join("/h/app", split.rest),
        // Jazyk určuje vždy cesta, ne prohlížeč: bez předpony česky, pod `/en` anglicky. Jinak by
        // odkaz „CS“ v přepínači vedl na stejnou adresu a angličtina z `Accept-Language` by zůstala.
        uiLocale: split.locale,
      };
    }
    case "admin":
      return { action: "rewrite", kind, pathname: join("/h/admin", pathname) };
  }
}
