import { expect, test, type APIRequestContext } from "@playwright/test";
import { HOSTS, apiRequest, type HostName } from "./hosts";

async function get(request: APIRequestContext, host: string, path = "/") {
  const { url, options } = apiRequest(host, path);
  return request.get(url, options);
}

const hostNames = Object.keys(HOSTS) as HostName[];

test.describe("hlavičky podle hostitele", () => {
  for (const name of hostNames) {
    test(`${name}: X-Robots-Tag a bezpečnostní hlavičky`, async ({ request }) => {
      // Přehled správy (`/`) vyžaduje relaci a přesměruje; veřejná je až přihlašovací stránka.
      const response = await get(request, HOSTS[name], name === "app" ? "/prihlaseni" : "/");
      expect(response.status()).toBe(200);
      const headers = response.headers();

      if (name === "marketing") {
        expect(headers["x-robots-tag"]).toBeUndefined();
      } else {
        expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
      }

      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["permissions-policy"]).toContain("camera=()");
      expect(headers["strict-transport-security"]).toContain("max-age=");
      expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(headers["content-security-policy"]).toContain("default-src 'self'");
      expect(headers["content-security-policy"]).toContain("object-src 'none'");
      expect(headers["x-powered-by"]).toBeUndefined();

      if (name === "tenant") {
        expect(headers["referrer-policy"]).toBe("no-referrer");
      } else {
        expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      }
      if (name === "app" || name === "admin") {
        expect(headers["cache-control"]).toBe("private, no-store");
      }
    });
  }
});

test.describe("robots.txt podle hostitele", () => {
  test("marketing: povolí vyhledávací a odpovědní roboty, zakáže trénování, odkáže na mapu", async ({
    request,
  }) => {
    const response = await get(request, HOSTS.marketing, "/robots.txt");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/plain");
    const body = await response.text();
    expect(body).toMatch(/User-agent: Googlebot[\s\S]*Allow: \//);
    expect(body).toContain("User-agent: OAI-SearchBot");
    expect(body).toContain("User-agent: GPTBot");
    expect(body).toContain("Sitemap: https://se-vezmou.cz/sitemap.xml");
    const blocked = body.split("\n\n")[1];
    expect(blocked).toContain("User-agent: GPTBot");
    expect(blocked).toContain("Disallow: /");
  });

  for (const name of ["app", "admin", "tenant"] as const) {
    test(`${name}: Disallow /`, async ({ request }) => {
      const response = await get(request, HOSTS[name], "/robots.txt");
      expect(response.status()).toBe(200);
      expect(await response.text()).toBe("User-agent: *\nDisallow: /\n");
      expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    });
  }
});

test.describe("sitemap.xml", () => {
  test("marketing: obě jazykové verze s alternativami", async ({ request }) => {
    const response = await get(request, HOSTS.marketing, "/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("xml");
    const body = await response.text();
    expect(body).toContain("<loc>https://se-vezmou.cz/</loc>");
    expect(body).toContain("<loc>https://se-vezmou.cz/en</loc>");
    expect(body).toContain('hreflang="x-default"');
  });

  for (const name of ["app", "admin", "tenant"] as const) {
    test(`${name}: mapa webu neexistuje`, async ({ request }) => {
      expect((await get(request, HOSTS[name], "/sitemap.xml")).status()).toBe(404);
    });
  }
});

test.describe("interní segmenty /h/* zvenku", () => {
  const paths = [
    "/h",
    "/h/marketing/cs",
    "/h/marketing/en",
    "/h/app",
    "/h/admin",
    "/h/tenant/klara-a-matej/cs",
    "/h/tenant/robots.txt",
    "/h/marketing/robots.txt",
  ];

  for (const name of hostNames) {
    test(`${name}: přímý požadavek vrací 404`, async ({ request }) => {
      for (const path of paths) {
        const response = await get(request, HOSTS[name], path);
        expect(response.status(), `${name} ${path}`).toBe(404);
      }
    });
  }

  test("neplatný hostitel: /h/* vrací 404", async ({ request }) => {
    expect((await get(request, "neznamy.example.com", "/h/marketing/cs")).status()).toBe(404);
  });
});

test.describe("neexistující a neplatní hostitelé", () => {
  test("neexistující web páru vrací stejné 404 jako každý jiný neexistující", async ({
    request,
  }) => {
    const a = await get(request, "neexistuje.localhost");
    const b = await get(request, "uplne-jiny-par.localhost");
    expect(a.status()).toBe(404);
    expect(b.status()).toBe(404);
    expect(a.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    // Stejné tělo (jediný rozdíl je slug, který si dotazující sám zadal), žádný výpis jiných webů.
    const normalize = (html: string, slug: string) => html.replaceAll(slug, "SLUG");
    expect(normalize(await a.text(), "neexistuje")).toBe(
      normalize(await b.text(), "uplne-jiny-par"),
    );
  });

  test("neexistující web páru: i podstránky vrací stejné 404 jako samotný web", async ({
    request,
  }) => {
    const page = await get(request, "neexistuje.localhost", "/");
    const sub = await get(request, "neexistuje.localhost", "/program");
    const en = await get(request, "neexistuje.localhost", "/en");
    expect(page.status()).toBe(404);
    expect(sub.status()).toBe(404);
    expect(en.status()).toBe(404);
  });

  test("existující web páru: neznámá podstránka je 404", async ({ request }) => {
    expect((await get(request, HOSTS.tenant, "/neexistuje")).status()).toBe(404);
  });

  for (const host of ["a.b.localhost", "api.localhost", "kl--ara.localhost", "static.localhost"]) {
    test(`${host} je 404`, async ({ request }) => {
      const response = await get(request, host);
      expect(response.status()).toBe(404);
      expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    });
  }

  test("www se přesměruje na holou doménu", async ({ request }) => {
    const response = await get(request, "www.localhost", "/en");
    expect(response.status()).toBe(308);
    // Next.js při samostatném provozu zkracuje odkaz na stejný původ, na kterém naslouchá server,
    // na relativní; absolutní tvar (holá doména) i relativní tvar proto oba končí cestou /en.
    // Absolutní adresu holé domény ověřuje jednotkový test směrování; na Vercelu ověřit ručně.
    expect(response.headers().location).toMatch(/(^|^http:\/\/localhost:\d+)\/en$/);
  });
});

test.describe("jazyk v adrese", () => {
  test("/cs je duplicita a vrací 404, /en funguje", async ({ request }) => {
    expect((await get(request, HOSTS.marketing, "/cs")).status()).toBe(404);
    expect((await get(request, HOSTS.marketing, "/en")).status()).toBe(200);
  });

  test("neznámá cesta úvodní stránky je 404", async ({ request }) => {
    expect((await get(request, HOSTS.marketing, "/neexistuje")).status()).toBe(404);
    expect((await get(request, HOSTS.marketing, "/en/neexistuje")).status()).toBe(404);
  });

  test("server nečte Accept-Language: česká stránka se nepřesměruje", async ({ request }) => {
    const { url, options } = apiRequest(HOSTS.marketing, "/");
    const response = await request.get(url, {
      ...options,
      headers: { ...options.headers, "accept-language": "en-GB,en;q=0.9" },
    });
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('lang="cs"');
  });
});

test.describe("tunel Sentry", () => {
  test("/monitoring se nepřepisuje podle hostitele (proxy ho vynechává)", async ({ request }) => {
    // Požadavek jde na rewrite Sentry; odpověď vrací Sentry nebo síť, nikdy 404 z naší aplikace.
    for (const host of [HOSTS.marketing, HOSTS.app]) {
      const { url, options } = apiRequest(host, "/monitoring?o=1&p=2");
      const response = await request.post(url, { ...options, data: "{}", timeout: 20_000 });
      expect(response.status(), host).not.toBe(404);
    }
  });
});

test.describe("katalog komponent", () => {
  test("je dostupný jen s ENABLE_UI_CATALOG (zapnuto v testovacím serveru)", async ({
    request,
  }) => {
    const response = await get(request, HOSTS.marketing, "/ui-catalog");
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('content="noindex, nofollow"');
  });

  test("na jiných hostitelích neexistuje", async ({ request }) => {
    expect((await get(request, HOSTS.app, "/ui-catalog")).status()).toBe(404);
  });
});
