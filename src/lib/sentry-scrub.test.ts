import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import {
  isSentryBrowserHost,
  sentryPrivacyOptions,
  scrubErrorEvent,
  scrubText,
  scrubTransactionEvent,
  scrubTransactionName,
  type TransactionEvent,
} from "./sentry-scrub";

const TOKEN = "tajnyTokenNahledu123";

function errorEvent(): ErrorEvent {
  return {
    type: undefined,
    message: `Chyba na https://klara-a-matej.se-vezmou.cz/nahled/${TOKEN}?x=1`,
    transaction: `GET /nahled/${TOKEN}?x=1`,
    request: {
      url: `https://klara-a-matej.se-vezmou.cz/cs/nahled/${TOKEN}`,
      query_string: "pin=123456",
      cookies: { "__Host-sv_guest": "secret" },
      headers: { cookie: "a=b", referer: "https://x.cz" },
      data: { name: "Klára" },
    },
    user: { ip_address: "1.2.3.4", email: "klara@example.cz" },
    breadcrumbs: [{ message: `fetch /nahled/${TOKEN}` }],
    extra: { url: `/nahled/${TOKEN}` },
    server_name: "host",
    tags: { url: `https://a.cz/nahled/${TOKEN}`, runtime: "node" },
    contexts: { trace: { trace_id: "t", span_id: "s", data: { "url.full": `/nahled/${TOKEN}` } } },
    exception: {
      values: [
        {
          type: "Error",
          value: `selhalo /nahled/${TOKEN} a https://x.se-vezmou.cz/media/abc/640`,
          stacktrace: {
            frames: [
              { filename: "a.js", abs_path: `https://x.se-vezmou.cz/_next/a.js`, vars: { p: 1 } },
            ],
          },
        },
      ],
    },
  } as ErrorEvent;
}

describe("scrubErrorEvent", () => {
  it("odstraní požadavek, uživatele, drobečky, rozšíření a tajné segmenty cest", () => {
    const out = scrubErrorEvent(errorEvent());
    const json = JSON.stringify(out);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain("klara-a-matej");
    expect(json).not.toContain("123456");
    expect(json).not.toContain("1.2.3.4");
    expect(out.request).toBeUndefined();
    expect(out.user).toBeUndefined();
    expect(out.breadcrumbs).toBeUndefined();
    expect(out.extra).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(out.transaction).toBe("GET /nahled/:token");
    expect(out.tags).toEqual({ runtime: "node" });
    expect(out.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars).toBeUndefined();
  });

  it("zachová typ chyby a zásobník", () => {
    const out = scrubErrorEvent(errorEvent());
    expect(out.exception?.values?.[0]?.type).toBe("Error");
    expect(out.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename).toBe("a.js");
  });
});

describe("scrubTransactionEvent", () => {
  it("zahodí spany a vyčistí název i data trasování", () => {
    const event = {
      type: "transaction",
      transaction: `GET /h/tenant/klara/cs/nahled/${TOKEN}?x=1`,
      request: { url: `https://x.se-vezmou.cz/nahled/${TOKEN}` },
      spans: [{ description: `GET https://x.se-vezmou.cz/nahled/${TOKEN}` }],
      contexts: {
        trace: { trace_id: "t", span_id: "s", data: { "http.url": `/nahled/${TOKEN}` } },
      },
    } as unknown as TransactionEvent;
    const out = scrubTransactionEvent(event);
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(out.spans).toEqual([]);
    expect(out.request).toBeUndefined();
    expect(out.transaction).toContain("/nahled/:token");
    expect(out.transaction).not.toContain("?");
  });
});

describe("scrubText a scrubTransactionName", () => {
  it("nahradí adresy a tajné cesty, šablony tras nechá být", () => {
    expect(scrubText("viz https://a.se-vezmou.cz/x?y=1 konec")).toBe("viz [odstraněno] konec");
    expect(scrubText(`/cs/nahled/${TOKEN}/`)).toBe("/cs/nahled/:token/");
    expect(scrubText("GET /en/p/0123456789abcdef0123")).toBe("GET /en/p/:code");
    expect(scrubText("/media/id1/640")).toBe("/media/:id/:width");
    expect(scrubTransactionName("/h/tenant/[slug]/[locale]")).toBe("/h/tenant/[slug]/[locale]");
    expect(scrubTransactionName("GET /a?token=1#h")).toBe("GET /a");
  });
});

describe("sentryPrivacyOptions", () => {
  it("vypíná sběr osobních údajů a zapíná statický životní cyklus pro čištění transakcí", () => {
    expect(sentryPrivacyOptions.sendDefaultPii).toBe(false);
    expect(sentryPrivacyOptions.traceLifecycle).toBe("static");
    expect(sentryPrivacyOptions.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    });
    expect(sentryPrivacyOptions.beforeBreadcrumb()).toBeNull();
  });
});

describe("isSentryBrowserHost", () => {
  const site = "https://se-vezmou.cz";
  it("povolí jen hostitele úvodní stránky", () => {
    expect(isSentryBrowserHost("se-vezmou.cz", site)).toBe(true);
    expect(isSentryBrowserHost("www.se-vezmou.cz", site)).toBe(true);
    expect(isSentryBrowserHost("SE-VEZMOU.CZ.", site)).toBe(true);
  });
  it("zakáže weby párů, průvodce, administraci i cizí hostitele", () => {
    expect(isSentryBrowserHost("klara-a-matej.se-vezmou.cz", site)).toBe(false);
    expect(isSentryBrowserHost("app.se-vezmou.cz", site)).toBe(false);
    expect(isSentryBrowserHost("admin.se-vezmou.cz", site)).toBe(false);
    expect(isSentryBrowserHost("evil-se-vezmou.cz", site)).toBe(false);
    expect(isSentryBrowserHost("x.vercel.app", site)).toBe(false);
    expect(isSentryBrowserHost("se-vezmou.cz", "neplatná adresa")).toBe(false);
  });
});
