import { NextResponse, type NextRequest } from "next/server";
import { isLocalHost } from "@/auth/cookie";
import { env } from "@/env";
import { hostConfigFromEnv, type HostKind } from "@/host/resolve";
import { routeRequest, type LocaleRoute } from "@/host/route";
import { UI_LOCALE_HEADER } from "@/host/ui-locale";
import { localePath, splitLocalePath, type Locale } from "@/i18n/config";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, decideLocale } from "@/i18n/negotiate";
import { localizedPath, matchPathname } from "@/i18n/pathnames";

/**
 * Směrování podle hostitele (ADR 0002): `Host` -> interní segment `/h/...`.
 *
 * Proxy je tenká a bez dotazů do databáze. NENÍ bezpečnostní hranice: každá Server Action
 * a route handler musí ověřit relaci a oprávnění sám (Server Actions jsou POST na cestu stránky
 * a vyloučení cesty z matcheru by jim odebralo i tuto vrstvu).
 *
 * Jazyk (ADR 0013): určuje ho adresa a proxy ho předá hlavičkou `x-ui-locale` (klientem poslanou
 * hodnotu vždy přepíše). Na hostitelích úvodní stránky, `app.` a `admin.` proxy při vstupu na
 * adresu bez předpony vyjedná jazyk (cookie `NEXT_LOCALE`, `Accept-Language`) a případně přesměruje
 * na předponu; cookie zapíše jen při výslovném přepnutí. Weby párů jazyky publikují v databázi,
 * kam proxy nesahá, takže tam se nevyjednává a nepřesměrovává: platí adresa.
 */

const hostConfig = hostConfigFromEnv(env, {
  development: env.NODE_ENV !== "production",
});

/** Hostitelé, kde proxy jazyk vyjednává (weby párů ne, viz výše). */
const NEGOTIATING_HOSTS: ReadonlySet<HostKind> = new Set(["marketing", "app", "admin"]);

/** Hlavičky podle druhu hostitele (FR-PRIV-1). Úvodní stránka je jediná indexovatelná. */
function applyHeaders(response: NextResponse, kind: HostKind | null, pathname = ""): NextResponse {
  if (kind !== "marketing") {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  if (kind === "app" || kind === "admin") {
    response.headers.set("Cache-Control", "private, no-store");
  }
  if (kind === "tenant") {
    // Adresa webu páru se nesmí prozradit odkazovaným stránkám.
    response.headers.set("Referrer-Policy", "no-referrer");
    // Náhled konceptu podle odkazu s tokenem se nikdy neukládá do mezipaměti.
    if (/^\/nahled(\/|$)/.test(splitLocalePath(pathname)?.path ?? pathname)) {
      response.headers.set("Cache-Control", "private, no-store");
    }
  }
  return response;
}

/**
 * Adresa téže stránky v jazyce `locale`, nebo `null`, když ji nejde určit. Úvodní stránka má
 * přeložené cesty (`/soukromi` -> `/en/privacy`), neznámá cesta se nepřesměruje (skončí 404).
 */
function localizedTarget(kind: HostKind, route: LocaleRoute, locale: Locale): string | null {
  if (kind === "marketing") {
    const match = matchPathname(route.path);
    return match ? localizedPath(match.route, locale) : null;
  }
  return localePath(route.path, locale);
}

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const decision = routeRequest(request.headers.get("host"), url.pathname, hostConfig);

  switch (decision.action) {
    case "notFound":
      // Prázdné 404, které nic nenabízí (žádný výpis webů, FR-PRIV-3).
      return applyHeaders(new NextResponse(null, { status: 404 }), decision.kind);

    case "passThrough":
      return applyHeaders(NextResponse.next(), decision.kind, url.pathname);

    case "rewrite": {
      const route = decision.locale;
      let locale = route?.locale;
      let remember: Locale | null = null;

      if (route && NEGOTIATING_HOSTS.has(decision.kind)) {
        const host = request.headers.get("host");
        const choice = decideLocale({
          method: request.method,
          pathLocale: route.pathLocale,
          header: (name) => request.headers.get(name),
          cookie: request.cookies.get(LOCALE_COOKIE)?.value,
          host,
        });
        if (choice.action === "redirect") {
          const pathname = localizedTarget(decision.kind, route, choice.locale);
          if (pathname) {
            const target = url.clone();
            target.pathname = pathname;
            // 307 s dotazem beze změny. Odpověď závisí na hlavičkách, nesmí ji sdílet mezipaměť.
            const response = NextResponse.redirect(target, 307);
            response.headers.set("Vary", "Accept-Language, Cookie");
            response.headers.set("Cache-Control", "private, no-store");
            return applyHeaders(response, decision.kind, url.pathname);
          }
        } else {
          locale = choice.locale;
          remember = choice.remember;
        }
      }

      const target = url.clone();
      target.pathname = decision.pathname;
      // Jazyk nese jen tato hlavička; klientem poslanou hodnotu vždy přepíšeme.
      const requestHeaders = new Headers(request.headers);
      requestHeaders.delete(UI_LOCALE_HEADER);
      if (locale) requestHeaders.set(UI_LOCALE_HEADER, locale);
      const response = NextResponse.rewrite(target, { request: { headers: requestHeaders } });
      if (remember) {
        // Volba jazyka (jen při výslovném přepnutí): funkční cookie bez osobních údajů,
        // jen pro tohoto hostitele (docs/security-privacy.md, seznam cookies).
        response.cookies.set(LOCALE_COOKIE, remember, {
          path: "/",
          sameSite: "lax",
          httpOnly: true,
          secure: !isLocalHost(request.headers.get("host")),
          maxAge: LOCALE_COOKIE_MAX_AGE,
        });
      }
      return applyHeaders(response, decision.kind, url.pathname);
    }
  }
}

export const config = {
  matcher: [
    // Vynecháno: statické soubory Next.js, tunel Sentry (`/monitoring`), cron a vývojová obdoba podepsaných
    // adres úložiště (`/api/dev-storage`, jen s úložištěm v paměti, jinak 404; fotografie M7c) a dlaždice mapy
    // (`/api/map-tile`, na všech hostitelích a se sdílenou mezipamětí, kterou proxy nesmí přepsat).
    "/((?!_next/static|_next/image|monitoring|api/cron|api/dev-storage|api/map-tile).*)",
  ],
};
