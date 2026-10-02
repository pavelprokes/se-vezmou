/**
 * Cookies přihlášení (docs/adr/0002, docs/security-privacy.md kap. 1.3). Čistý modul.
 *
 * Ostrý provoz: název s prefixem `__Host-` (prohlížeč vynutí `Secure`, `Path=/` a žádný `Domain`),
 * `HttpOnly`, `Secure`, `SameSite=Lax`. Cookie tedy platí jen pro přesného hostitele
 * (`app.se-vezmou.cz`) a nikdy ne pro celou doménu.
 *
 * Lokální vývoj (`localhost`, `*.localhost`): prefix `__Host-` a `Secure` se vynechávají, protože
 * `http://app.localhost:3000` není HTTPS a prohlížeče by cookie s `Secure` nepřijaly spolehlivě.
 * Next.js `cookies().set()` jiná pravidla pro vývoj nemá, atributy se prostě předávají v options.
 * Rozhodnutí vychází z hlavičky `Host`, kterou do aplikace pustí jen `src/proxy.ts` pro známé
 * hostitele; na `localhost` se tedy produkční doména nikdy nedostane.
 */

export const COOKIE_KINDS = {
  /** Relace správce na `app.`. */
  admin: "sv_admin",
  /** Rozpracované přihlášení kódem (zapečetěný e-mail) na `app.`. */
  pending: "sv_login",
} as const;

export type CookieKind = keyof typeof COOKIE_KINDS;

export interface CookieSpec {
  name: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    path: "/";
    maxAge?: number;
  };
}

/** `localhost` a `*.localhost` (bez portu, malými písmeny). */
export function isLocalHost(hostHeader: string | null | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader
    .trim()
    .toLowerCase()
    .replace(/:\d{1,5}$/, "");
  return host === "localhost" || host.endsWith(".localhost");
}

/** Název a atributy cookie pro hostitele. Bez `domain`: cookie je vždy jen pro tohoto hostitele. */
export function cookieSpec(
  kind: CookieKind,
  hostHeader: string | null | undefined,
  maxAgeSeconds?: number,
): CookieSpec {
  const local = isLocalHost(hostHeader);
  return {
    name: local ? COOKIE_KINDS[kind] : `__Host-${COOKIE_KINDS[kind]}`,
    options: {
      httpOnly: true,
      secure: !local,
      sameSite: "lax",
      path: "/",
      ...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds }),
    },
  };
}

/** Pro odstranění cookie: stejný název a atributy, okamžité vypršení. */
export function expiredCookieSpec(kind: CookieKind, hostHeader: string | null | undefined) {
  const spec = cookieSpec(kind, hostHeader, 0);
  return { name: spec.name, value: "", options: spec.options };
}
