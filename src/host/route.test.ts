import { describe, expect, it } from "vitest";
import type { HostConfig } from "./resolve";
import { routeRequest } from "./route";

const config: HostConfig = { rootDomains: ["se-vezmou.cz"] };
const route = (host: string, path: string) => routeRequest(host, path, config);

describe("routeRequest: přepis na interní segmenty", () => {
  it("marketing: čeština na / a angličtina pod /en", () => {
    expect(route("se-vezmou.cz", "/")).toEqual({
      action: "rewrite",
      kind: "marketing",
      pathname: "/h/marketing/cs",
    });
    expect(route("se-vezmou.cz", "/en")).toEqual({
      action: "rewrite",
      kind: "marketing",
      pathname: "/h/marketing/en",
    });
    expect(route("se-vezmou.cz", "/en/pricing")).toMatchObject({
      pathname: "/h/marketing/en/pricing",
    });
    expect(route("se-vezmou.cz", "/cenik")).toMatchObject({ pathname: "/h/marketing/cs/cenik" });
  });

  it("marketing: české cesty s /cs jsou duplicita, 404", () => {
    expect(route("se-vezmou.cz", "/cs")).toEqual({ action: "notFound", kind: "marketing" });
    expect(route("se-vezmou.cz", "/cs/cenik")).toEqual({ action: "notFound", kind: "marketing" });
  });

  it("app a admin", () => {
    expect(route("app.se-vezmou.cz", "/")).toMatchObject({ pathname: "/h/app", kind: "app" });
    expect(route("app.se-vezmou.cz", "/prihlaseni")).toMatchObject({
      pathname: "/h/app/prihlaseni",
    });
    expect(route("admin.se-vezmou.cz", "/")).toMatchObject({
      pathname: "/h/admin",
      kind: "admin",
    });
  });

  it("tenant: slug z hostitele a jazyk z prefixu", () => {
    expect(route("klara-a-matej.se-vezmou.cz", "/")).toMatchObject({
      kind: "tenant",
      pathname: "/h/tenant/klara-a-matej/cs",
    });
    expect(route("klara-a-matej.se-vezmou.cz", "/en/program")).toMatchObject({
      pathname: "/h/tenant/klara-a-matej/en/program",
    });
  });

  it("slug v cestě se nikdy nebere z URL, jen z hostitele", () => {
    expect(route("klara-a-matej.se-vezmou.cz", "/jiny-par")).toMatchObject({
      pathname: "/h/tenant/klara-a-matej/cs/jiny-par",
    });
  });
});

describe("routeRequest: jazyk rozhraní na hostiteli app", () => {
  it("/en/... se přepíše na stejnou cestu a jazyk nese pole uiLocale", () => {
    expect(route("app.se-vezmou.cz", "/en/vytvorit")).toEqual({
      action: "rewrite",
      kind: "app",
      pathname: "/h/app/vytvorit",
      uiLocale: "en",
    });
    expect(route("app.se-vezmou.cz", "/en")).toMatchObject({ pathname: "/h/app", uiLocale: "en" });
    expect(route("app.se-vezmou.cz", "/en/prihlaseni")).toMatchObject({
      pathname: "/h/app/prihlaseni",
      uiLocale: "en",
    });
  });

  it("průvodce je česky podle cesty, ne podle prohlížeče", () => {
    expect(route("app.se-vezmou.cz", "/vytvorit")).toMatchObject({
      pathname: "/h/app/vytvorit",
      uiLocale: "cs",
    });
    expect(route("app.se-vezmou.cz", "/vytvorit/nahled")).toMatchObject({ uiLocale: "cs" });
  });

  it("ostatní stránky bez jazyka v cestě volí jazyk podle prohlížeče (bez uiLocale)", () => {
    expect(route("app.se-vezmou.cz", "/prihlaseni")).not.toHaveProperty("uiLocale");
  });

  it("/cs/... je duplicita, 404; admin předponu /en nezná", () => {
    expect(route("app.se-vezmou.cz", "/cs/vytvorit")).toEqual({ action: "notFound", kind: "app" });
    expect(route("admin.se-vezmou.cz", "/en")).toMatchObject({ pathname: "/h/admin/en" });
  });
});

describe("routeRequest: blokace a 404", () => {
  it.each([
    "se-vezmou.cz",
    "app.se-vezmou.cz",
    "admin.se-vezmou.cz",
    "klara-a-matej.se-vezmou.cz",
    "neznamy.example.com",
  ])("přímý přístup na /h/* zvenku je 404 na %s", (host) => {
    for (const path of ["/h", "/h/marketing/cs", "/h/tenant/klara-a-matej/cs", "/h/app"]) {
      expect(route(host, path).action).toBe("notFound");
    }
  });

  it("neznámý hostitel a víceúrovňová subdomena je 404 bez druhu", () => {
    expect(route("neznamy.example.com", "/")).toEqual({ action: "notFound", kind: null });
    expect(route("a.b.se-vezmou.cz", "/")).toEqual({ action: "notFound", kind: null });
  });

  it("cesta začínající jen podobně jako /h se neblokuje", () => {
    expect(route("se-vezmou.cz", "/hostina").action).toBe("rewrite");
  });

  it("www přesměruje", () => {
    expect(route("www.se-vezmou.cz", "/")).toEqual({ action: "redirectWww" });
  });
});

describe("routeRequest: robots.txt, sitemap.xml, statické soubory", () => {
  it("robots.txt se mapuje na handlera daného hostitele", () => {
    expect(route("se-vezmou.cz", "/robots.txt")).toMatchObject({
      pathname: "/h/marketing/robots.txt",
    });
    expect(route("app.se-vezmou.cz", "/robots.txt")).toMatchObject({
      pathname: "/h/app/robots.txt",
    });
    expect(route("admin.se-vezmou.cz", "/robots.txt")).toMatchObject({
      pathname: "/h/admin/robots.txt",
    });
    expect(route("klara-a-matej.se-vezmou.cz", "/robots.txt")).toMatchObject({
      pathname: "/h/tenant/robots.txt",
    });
  });

  it("sitemap.xml jen na marketingu", () => {
    expect(route("se-vezmou.cz", "/sitemap.xml")).toMatchObject({
      pathname: "/h/marketing/sitemap.xml",
    });
    expect(route("app.se-vezmou.cz", "/sitemap.xml").action).toBe("notFound");
    expect(route("klara-a-matej.se-vezmou.cz", "/sitemap.xml").action).toBe("notFound");
  });

  it("veřejné soubory se nepřepisují", () => {
    expect(route("se-vezmou.cz", "/favicon.ico").action).toBe("passThrough");
    expect(route("klara-a-matej.se-vezmou.cz", "/obrazek.png").action).toBe("passThrough");
  });
});
