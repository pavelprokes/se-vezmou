import { describe, expect, it } from "vitest";
import { defaultLocale, locales } from "@/i18n/config";
import type { HostConfig } from "./resolve";
import { routeRequest } from "./route";

const config: HostConfig = { rootDomains: ["se-vezmou.cz"] };
const route = (host: string, path: string) => routeRequest(host, path, config);

describe("routeRequest: přepis na interní segmenty", () => {
  it("marketing: čeština na / a angličtina pod /en", () => {
    expect(route("se-vezmou.cz", "/")).toMatchObject({
      action: "rewrite",
      kind: "marketing",
      pathname: "/h/marketing/cs",
    });
    expect(route("se-vezmou.cz", "/en")).toMatchObject({
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

const others = locales.filter((l) => l !== defaultLocale);

describe("routeRequest: jazyk z adresy na všech hostitelích", () => {
  it("marketing a tenant: jazyk je segment interní cesty a nese ho i pole locale", () => {
    expect(route("se-vezmou.cz", "/")).toEqual({
      action: "rewrite",
      kind: "marketing",
      pathname: `/h/marketing/${defaultLocale}`,
      locale: { locale: defaultLocale, pathLocale: null, path: "/" },
    });
    for (const locale of others) {
      expect(route("se-vezmou.cz", `/${locale}/privacy`)).toEqual({
        action: "rewrite",
        kind: "marketing",
        pathname: `/h/marketing/${locale}/privacy`,
        locale: { locale, pathLocale: locale, path: "/privacy" },
      });
      expect(route("klara-a-matej.se-vezmou.cz", `/${locale}`)).toMatchObject({
        pathname: `/h/tenant/klara-a-matej/${locale}`,
        locale: { locale, pathLocale: locale, path: "/" },
      });
    }
  });

  for (const host of ["app.se-vezmou.cz", "admin.se-vezmou.cz"]) {
    const kind = host.split(".")[0];
    it(`${kind}: /<jazyk>/... se přepíše na stejnou cestu a jazyk nese pole locale`, () => {
      for (const locale of others) {
        expect(route(host, `/${locale}/prihlaseni`)).toEqual({
          action: "rewrite",
          kind,
          pathname: `/h/${kind}/prihlaseni`,
          locale: { locale, pathLocale: locale, path: "/prihlaseni" },
        });
        expect(route(host, `/${locale}`)).toMatchObject({
          pathname: `/h/${kind}`,
          locale: { locale, pathLocale: locale, path: "/" },
        });
        expect(route(host, `/${locale}/`)).toMatchObject({
          pathname: `/h/${kind}`,
          locale: { locale, pathLocale: locale, path: "/" },
        });
      }
    });

    it(`${kind}: jazyk určuje cesta: bez předpony výchozí jazyk (bez výslovné volby)`, () => {
      for (const path of ["/", "/web", "/prihlaseni", "/hoste/import", "/zakazky"]) {
        expect(route(host, path)).toMatchObject({
          pathname: path === "/" ? `/h/${kind}` : `/h/${kind}${path}`,
          locale: { locale: defaultLocale, pathLocale: null, path },
        });
        for (const locale of others) {
          expect(route(host, `/${locale}${path === "/" ? "" : path}`)).toMatchObject({
            locale: { locale, pathLocale: locale, path },
          });
        }
      }
    });

    it(`${kind}: předpona výchozího jazyka je duplicita (404)`, () => {
      expect(route(host, `/${defaultLocale}`)).toEqual({ action: "notFound", kind });
      expect(route(host, `/${defaultLocale}/prihlaseni`)).toEqual({ action: "notFound", kind });
    });
  }

  it("neznámá předpona není jazyk, ale cesta výchozího jazyka", () => {
    expect(route("se-vezmou.cz", "/de/x")).toMatchObject({
      pathname: `/h/marketing/${defaultLocale}/de/x`,
      locale: { locale: defaultLocale, pathLocale: null, path: "/de/x" },
    });
    expect(route("app.se-vezmou.cz", "/english")).toMatchObject({
      pathname: "/h/app/english",
      locale: { locale: defaultLocale, pathLocale: null },
    });
  });

  it("robots.txt a sitemap.xml jazyk nemají", () => {
    expect(route("se-vezmou.cz", "/robots.txt")).not.toHaveProperty("locale");
    expect(route("se-vezmou.cz", "/sitemap.xml")).not.toHaveProperty("locale");
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

  it("www se obslouží jako úvodní stránka, bez přesměrování (jinak smyčka s přesměrováním ve Vercelu)", () => {
    expect(route("www.se-vezmou.cz", "/")).toEqual(route("se-vezmou.cz", "/"));
    expect(route("www.se-vezmou.cz", "/en")).toEqual(route("se-vezmou.cz", "/en"));
    expect(route("www.se-vezmou.cz", "/").action).toBe("rewrite");
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

  it("llms.txt jen na marketingu", () => {
    expect(route("se-vezmou.cz", "/llms.txt")).toMatchObject({
      pathname: "/h/marketing/llms.txt",
    });
    expect(route("app.se-vezmou.cz", "/llms.txt").action).toBe("notFound");
    expect(route("klara-a-matej.se-vezmou.cz", "/llms.txt").action).toBe("notFound");
  });

  it("veřejné soubory se nepřepisují", () => {
    expect(route("se-vezmou.cz", "/favicon.ico").action).toBe("passThrough");
    expect(route("klara-a-matej.se-vezmou.cz", "/obrazek.png").action).toBe("passThrough");
  });
});
