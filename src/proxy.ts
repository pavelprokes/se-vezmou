import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import { hostConfigFromEnv, type HostKind } from "@/host/resolve";
import { routeRequest } from "@/host/route";
import { UI_LOCALE_HEADER } from "@/host/ui-locale";

/**
 * Směrování podle hostitele (ADR 0002): `Host` -> interní segment `/h/...`.
 *
 * Proxy je tenká a bez dotazů do databáze. NENÍ bezpečnostní hranice: každá Server Action
 * a route handler musí ověřit relaci a oprávnění sám (Server Actions jsou POST na cestu stránky
 * a vyloučení cesty z matcheru by jim odebralo i tuto vrstvu).
 */

const hostConfig = hostConfigFromEnv(env, {
  development: env.NODE_ENV !== "production",
});

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
    if (/^(\/en)?\/nahled(\/|$)/.test(pathname)) {
      response.headers.set("Cache-Control", "private, no-store");
    }
  }
  return response;
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
      const target = url.clone();
      target.pathname = decision.pathname;
      // Jazyk rozhraní nese jen tato hlavička; klientem poslanou hodnotu vždy přepíšeme.
      const requestHeaders = new Headers(request.headers);
      requestHeaders.delete(UI_LOCALE_HEADER);
      if (decision.uiLocale) requestHeaders.set(UI_LOCALE_HEADER, decision.uiLocale);
      return applyHeaders(
        NextResponse.rewrite(target, { request: { headers: requestHeaders } }),
        decision.kind,
        url.pathname,
      );
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
