import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { UI_LOCALE_HEADER } from "@/host/ui-locale";
import { defaultLocale, locales } from "@/i18n/config";
import { LOCALE_COOKIE } from "@/i18n/negotiate";
import { proxy } from "./proxy";

/**
 * Proxy a jazyk (ADR 0013): přesměrování při vstupu, hlavička s jazykem, cookie jen při výslovném
 * přepnutí. Čistá logika je v `src/i18n/negotiate.ts`; tady se ověřuje, co z ní proxy udělá.
 */

const others = locales.filter((l) => l !== defaultLocale);

/** Hlavičky, které Chromium posílá při zadání adresy a při kliknutí na odkaz. */
const typed = {
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
};
const clicked = { ...typed, "sec-fetch-site": "same-origin", "sec-fetch-user": "?1" };

function call(host: string, path: string, headers: Record<string, string> = {}, cookie?: string) {
  const request = new NextRequest(`https://${host}${path}`, {
    headers: { host, ...headers, ...(cookie ? { cookie: `${LOCALE_COOKIE}=${cookie}` } : {}) },
  });
  return proxy(request);
}

function forwardedLocale(response: Response): string | null {
  return response.headers.get(`x-middleware-request-${UI_LOCALE_HEADER}`);
}

const HOSTS = {
  marketing: "se-vezmou.cz",
  app: "app.se-vezmou.cz",
  admin: "admin.se-vezmou.cz",
  tenant: "klara-a-matej.se-vezmou.cz",
} as const;

describe("proxy: vyjednání jazyka při vstupu", () => {
  for (const other of others) {
    it(`marketing: prohlížeč v jazyce ${other} na / dostane 307 na /${other} s dotazem`, () => {
      const response = call(HOSTS.marketing, "/?utm=x", { ...typed, "accept-language": other });
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location") ?? "").pathname).toBe(`/${other}`);
      expect(new URL(response.headers.get("location") ?? "").search).toBe("?utm=x");
      expect(response.headers.get("vary")).toBe("Accept-Language, Cookie");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it(`marketing: přeložená cesta vede na překlad (/soukromi -> /${other}/privacy)`, () => {
      const response = call(HOSTS.marketing, "/soukromi", { ...typed, "accept-language": other });
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location") ?? "").pathname).toBe(`/${other}/privacy`);
    });

    it("marketing: neznámá cesta se nepřesměruje (skončí 404 ve výchozím jazyce)", () => {
      const response = call(HOSTS.marketing, "/neexistuje", { ...typed, "accept-language": other });
      expect(response.status).toBe(200);
      expect(forwardedLocale(response)).toBe(defaultLocale);
    });

    for (const host of [HOSTS.app, HOSTS.admin]) {
      it(`${host}: vstup na /prihlaseni s cookie ${other} vede na /${other}/prihlaseni`, () => {
        const response = call(host, "/prihlaseni?x=1", typed, other);
        expect(response.status).toBe(307);
        const location = new URL(response.headers.get("location") ?? "");
        expect(location.pathname).toBe(`/${other}/prihlaseni`);
        expect(location.search).toBe("?x=1");
        expect(response.headers.get("vary")).toBe("Accept-Language, Cookie");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
      });
    }

    it("web páru nikdy nepřesměruje a cookie nezapisuje (jazyky webu jsou v databázi)", () => {
      const entry = call(HOSTS.tenant, "/", { ...typed, "accept-language": other }, other);
      expect(entry.status).toBe(200);
      expect(forwardedLocale(entry)).toBe(defaultLocale);
      const switched = call(HOSTS.tenant, `/${other}`, { ...clicked, "accept-language": "cs" });
      expect(forwardedLocale(switched)).toBe(other);
      expect(switched.headers.get("set-cookie")).toBeNull();
    });

    it("RSC a předběžné načtení se nepřesměrují", () => {
      const rsc = call(HOSTS.app, "/web", {
        ...clicked,
        "sec-fetch-dest": "empty",
        "accept-language": other,
      });
      expect(rsc.status).toBe(200);
      const prefetch = call(HOSTS.marketing, "/", {
        ...typed,
        "sec-purpose": "prefetch",
        "accept-language": other,
      });
      expect(prefetch.status).toBe(200);
    });
  }

  it("robot bez Accept-Language a bez cookie dostane výchozí jazyk bez přesměrování", () => {
    for (const host of [HOSTS.marketing, HOSTS.app, HOSTS.admin]) {
      const response = call(host, "/", { accept: "text/html" });
      expect(response.status).toBe(200);
      expect(forwardedLocale(response)).toBe(defaultLocale);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("klientem podvržená hlavička jazyka se přepíše jazykem z adresy", () => {
    const response = call(HOSTS.app, "/prihlaseni", { [UI_LOCALE_HEADER]: "en" });
    expect(forwardedLocale(response)).toBe(defaultLocale);
  });
});

describe("proxy: výslovné přepnutí jazyka", () => {
  for (const other of others) {
    it(`klik na výchozí jazyk z /${other} s prohlížečem ${other}: bez přesměrování, cookie výchozího jazyka`, () => {
      const response = call(HOSTS.marketing, "/", { ...clicked, "accept-language": other });
      expect(response.status).toBe(200);
      expect(forwardedLocale(response)).toBe(defaultLocale);
      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toContain(`${LOCALE_COOKIE}=${defaultLocale}`);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).toMatch(/SameSite=lax/i);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Max-Age=31536000/);
      expect(cookie).not.toMatch(/Domain=/i);
    });

    it(`potom vstup na / s cookie výchozího jazyka zůstane ve výchozím jazyce`, () => {
      const response = call(HOSTS.marketing, "/", { ...typed, "accept-language": other }, "cs");
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it(`klik na ${other} s prohlížečem ve výchozím jazyce uloží ${other}`, () => {
      for (const host of [HOSTS.marketing, HOSTS.app, HOSTS.admin]) {
        const response = call(host, `/${other}`, { ...clicked, "accept-language": "cs-CZ" });
        expect(response.status).toBe(200);
        expect(forwardedLocale(response)).toBe(other);
        expect(response.headers.get("set-cookie")).toContain(`${LOCALE_COOKIE}=${other}`);
      }
    });

    it("navigace ve stejném jazyce jako preference cookie nezapisuje", () => {
      const response = call(HOSTS.app, `/${other}/hoste`, { ...clicked, "accept-language": other });
      expect(response.headers.get("set-cookie")).toBeNull();
      const same = call(HOSTS.app, "/hoste", { ...clicked, "accept-language": "cs" });
      expect(same.headers.get("set-cookie")).toBeNull();
    });
  }

  it("na localhost je cookie bez Secure (vývoj a e2e přes http)", () => {
    const response = call("localhost:3000", "/", { ...clicked, "accept-language": "en" });
    expect(response.headers.get("set-cookie")).not.toMatch(/Secure/);
  });
});
