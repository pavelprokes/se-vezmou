import { describe, expect, it } from "vitest";
import { defaultLocale, locales, type Locale } from "./config";
import {
  decideLocale,
  isDocumentRequest,
  isSiteNavigation,
  matchAcceptLanguage,
  negotiateLocale,
  parseAcceptLanguage,
  preferredLocale,
  type LocaleRequest,
} from "./negotiate";

const others = locales.filter((l) => l !== defaultLocale);

describe("parseAcceptLanguage", () => {
  it("řadí podle q sestupně a stejné váhy podle pořadí v hlavičce", () => {
    expect(parseAcceptLanguage("en-GB,en;q=0.9,cs;q=0.8,de")).toEqual([
      { tag: "en-gb", q: 1 },
      { tag: "de", q: 1 },
      { tag: "en", q: 0.9 },
      { tag: "cs", q: 0.8 },
    ]);
  });

  it("toleruje mezery, velká písmena a další parametry", () => {
    expect(parseAcceptLanguage(" EN-us ; Q=0.5 , cs")).toEqual([
      { tag: "cs", q: 1 },
      { tag: "en-us", q: 0.5 },
    ]);
  });

  it("neplatnou váhu nebo značku ignoruje, q=0 ponechá", () => {
    expect(parseAcceptLanguage("en;q=2,cs;q=abc,de;q=0,fr;q=0.123,x_y,*;q=0.1")).toEqual([
      { tag: "fr", q: 0.123 },
      { tag: "*", q: 0.1 },
      { tag: "de", q: 0 },
    ]);
  });

  it("prázdná a chybějící hlavička jsou prázdný seznam", () => {
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage("")).toEqual([]);
  });
});

describe("matchAcceptLanguage", () => {
  it("každý nabízený jazyk se najde přesně i podle regionu", () => {
    for (const locale of locales) {
      expect(matchAcceptLanguage(locale)).toBe(locale);
      expect(matchAcceptLanguage(`${locale}-XX`)).toBe(locale);
      expect(matchAcceptLanguage(`${locale.toUpperCase()}`)).toBe(locale);
    }
  });

  it("en-GB -> en, cs-CZ -> cs", () => {
    expect(matchAcceptLanguage("en-GB,en;q=0.9")).toBe("en");
    expect(matchAcceptLanguage("cs-CZ,cs;q=0.9,en;q=0.8")).toBe("cs");
  });

  it("respektuje váhy, ne pořadí", () => {
    expect(matchAcceptLanguage("cs;q=0.5,en;q=0.9")).toBe("en");
    expect(matchAcceptLanguage("en;q=0.5,cs")).toBe("cs");
  });

  it("nenabízené jazyky přeskočí", () => {
    expect(matchAcceptLanguage("de-DE,de;q=0.9,en;q=0.5")).toBe("en");
    expect(matchAcceptLanguage("de-DE,fr")).toBeNull();
  });

  it("* znamená výchozí jazyk, pokud není vyloučen", () => {
    expect(matchAcceptLanguage("*")).toBe(defaultLocale);
    expect(matchAcceptLanguage("de,*;q=0.5")).toBe(defaultLocale);
    expect(matchAcceptLanguage(`${defaultLocale};q=0,*`)).toBe(others[0]);
  });

  it("q=0 jazyk vylučuje i s regionem", () => {
    expect(matchAcceptLanguage("en-GB,en;q=0")).toBeNull();
    expect(matchAcceptLanguage("en;q=0,cs;q=0.1")).toBe("cs");
    // Vyloučení regionální varianty nevylučuje celý jazyk.
    expect(matchAcceptLanguage("en-GB;q=0,en;q=0.5")).toBe("en");
  });

  it("bez hlavičky nic", () => {
    expect(matchAcceptLanguage(undefined)).toBeNull();
    expect(matchAcceptLanguage("")).toBeNull();
  });

  it("hodnotí jen zadané jazyky", () => {
    expect(matchAcceptLanguage("en", ["cs"])).toBeNull();
  });
});

describe("preferredLocale (dřívější pickLocale pro jazyk správy)", () => {
  it("čeština je výchozí", () => {
    expect(preferredLocale(null, null)).toBe("cs");
    expect(preferredLocale(null, "")).toBe("cs");
    expect(preferredLocale(null, "de-DE,fr;q=0.8")).toBe("cs");
  });

  it("angličtina jen když je upřednostněna", () => {
    expect(preferredLocale(null, "en-GB,en;q=0.9")).toBe("en");
    expect(preferredLocale(null, "en-US")).toBe("en");
    expect(preferredLocale(null, "cs-CZ,cs;q=0.9,en;q=0.8")).toBe("cs");
    expect(preferredLocale(null, "en;q=0.5,cs;q=0.9")).toBe("cs");
    expect(preferredLocale(null, "de,en;q=0.5")).toBe("en");
  });

  it("ignoruje jazyky s q=0 a nesmyslné hodnoty", () => {
    expect(preferredLocale(null, "en;q=0,cs;q=0.1")).toBe("cs");
    expect(preferredLocale(null, "en;q=abc")).toBe("cs");
  });
});

describe("negotiateLocale", () => {
  it("předpona > cookie > Accept-Language > výchozí", () => {
    for (const other of others) {
      expect(
        negotiateLocale({ pathLocale: other, cookie: defaultLocale, acceptLanguage: "cs" }),
      ).toBe(other);
      expect(negotiateLocale({ pathLocale: null, cookie: other, acceptLanguage: "cs" })).toBe(
        other,
      );
      expect(negotiateLocale({ pathLocale: null, cookie: null, acceptLanguage: other })).toBe(
        other,
      );
    }
    expect(negotiateLocale({ pathLocale: null, cookie: "en", acceptLanguage: "en" })).toBe("en");
    expect(negotiateLocale({ pathLocale: null, cookie: "cs", acceptLanguage: "en" })).toBe("cs");
    expect(negotiateLocale({ pathLocale: null, cookie: null, acceptLanguage: null })).toBe(
      defaultLocale,
    );
  });

  it("neplatná cookie se ignoruje", () => {
    expect(negotiateLocale({ pathLocale: null, cookie: "de", acceptLanguage: "en" })).toBe("en");
    expect(negotiateLocale({ pathLocale: null, cookie: "", acceptLanguage: null })).toBe(
      defaultLocale,
    );
  });
});

function headers(values: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return (name: string) => lower[name.toLowerCase()] ?? null;
}

/** Hlavičky, které Chromium posílá při načtení stránky. */
const typed = {
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
};
const clicked = { ...typed, "sec-fetch-site": "same-origin", "sec-fetch-user": "?1" };

describe("isDocumentRequest", () => {
  it("načtení stránky prohlížečem ano", () => {
    expect(isDocumentRequest("GET", headers(typed))).toBe(true);
    expect(isDocumentRequest("HEAD", headers(clicked))).toBe(true);
  });

  it("RSC, fetch, obrázky, předběžné načtení a POST ne", () => {
    expect(isDocumentRequest("GET", headers({ ...typed, "sec-fetch-dest": "empty" }))).toBe(false);
    expect(isDocumentRequest("GET", headers({ ...typed, "sec-fetch-dest": "image" }))).toBe(false);
    expect(isDocumentRequest("GET", headers({ ...typed, "sec-purpose": "prefetch" }))).toBe(false);
    expect(
      isDocumentRequest("GET", headers({ ...typed, "sec-purpose": "prefetch;prerender" })),
    ).toBe(false);
    expect(isDocumentRequest("GET", headers({ ...typed, purpose: "prefetch" }))).toBe(false);
    expect(isDocumentRequest("GET", headers({ ...typed, rsc: "1" }))).toBe(false);
    expect(isDocumentRequest("GET", headers({ ...typed, "next-router-prefetch": "1" }))).toBe(
      false,
    );
    expect(isDocumentRequest("POST", headers(typed))).toBe(false);
  });

  it("bez Sec-Fetch-Dest rozhoduje Accept", () => {
    expect(isDocumentRequest("GET", headers({ accept: "text/html,*/*;q=0.8" }))).toBe(true);
    expect(isDocumentRequest("GET", headers({ accept: "*/*" }))).toBe(false);
    expect(isDocumentRequest("GET", headers({}))).toBe(false);
  });
});

describe("isSiteNavigation", () => {
  it("same-origin a same-site ano, none a cross-site ne", () => {
    expect(isSiteNavigation(headers({ "sec-fetch-site": "same-origin" }), "a.cz")).toBe(true);
    expect(isSiteNavigation(headers({ "sec-fetch-site": "same-site" }), "a.cz")).toBe(true);
    expect(isSiteNavigation(headers({ "sec-fetch-site": "none" }), "a.cz")).toBe(false);
    expect(isSiteNavigation(headers({ "sec-fetch-site": "cross-site" }), "a.cz")).toBe(false);
  });

  it("Sec-Fetch-Site má přednost před Referer", () => {
    expect(
      isSiteNavigation(
        headers({ "sec-fetch-site": "cross-site", referer: "https://a.cz/x" }),
        "a.cz",
      ),
    ).toBe(false);
  });

  it("bez Sec-Fetch-Site rozhoduje Referer ze stejného hostitele", () => {
    expect(isSiteNavigation(headers({ referer: "https://a.cz/en" }), "a.cz")).toBe(true);
    expect(isSiteNavigation(headers({ referer: "https://A.cz:443/" }), "a.cz")).toBe(true);
    expect(isSiteNavigation(headers({ referer: "https://b.cz/" }), "a.cz")).toBe(false);
    expect(isSiteNavigation(headers({ referer: "nesmysl" }), "a.cz")).toBe(false);
    expect(isSiteNavigation(headers({}), "a.cz")).toBe(false);
  });
});

function request(
  pathLocale: Locale | null,
  values: Record<string, string>,
  cookie: string | null = null,
  method = "GET",
): LocaleRequest {
  return { method, pathLocale, header: headers(values), cookie, host: "se-vezmou.cz" };
}

describe("decideLocale", () => {
  for (const other of others) {
    describe(`jazyk ${other}`, () => {
      it("vstup s prohlížečem v jazyce na cestu bez předpony přesměruje", () => {
        expect(decideLocale(request(null, { ...typed, "accept-language": other }))).toEqual({
          action: "redirect",
          locale: other,
        });
      });

      it("vstup s cookie přesměruje i s prohlížečem ve výchozím jazyce", () => {
        expect(
          decideLocale(request(null, { ...typed, "accept-language": defaultLocale }, other)),
        ).toEqual({ action: "redirect", locale: other });
      });

      it("cookie výchozího jazyka má přednost před prohlížečem", () => {
        expect(
          decideLocale(request(null, { ...typed, "accept-language": other }, defaultLocale)),
        ).toEqual({ action: "continue", locale: defaultLocale, remember: null });
      });

      it("přepnutí na výchozí jazyk (klik na cestu bez předpony) nepřesměruje a uloží volbu", () => {
        expect(decideLocale(request(null, { ...clicked, "accept-language": other }))).toEqual({
          action: "continue",
          locale: defaultLocale,
          remember: defaultLocale,
        });
        expect(
          decideLocale(request(null, { ...clicked, "accept-language": other }, other)),
        ).toEqual({ action: "continue", locale: defaultLocale, remember: defaultLocale });
      });

      it("přepnutí na jazyk s předponou uloží volbu, jen pokud se liší od preference", () => {
        expect(decideLocale(request(other, { ...clicked, "accept-language": "cs" }))).toEqual({
          action: "continue",
          locale: other,
          remember: other,
        });
        expect(decideLocale(request(other, { ...clicked, "accept-language": other }))).toEqual({
          action: "continue",
          locale: other,
          remember: null,
        });
        expect(
          decideLocale(request(other, { ...clicked, "accept-language": "cs" }, other)),
        ).toEqual({ action: "continue", locale: other, remember: null });
      });

      it("adresa s předponou platí vždy a vstup cookie nemění", () => {
        expect(decideLocale(request(other, typed, defaultLocale))).toEqual({
          action: "continue",
          locale: other,
          remember: null,
        });
      });

      it("RSC a předběžné načtení se nepřesměrují ani neukládají", () => {
        const rsc = { ...clicked, "sec-fetch-dest": "empty", "accept-language": other };
        expect(decideLocale(request(null, rsc))).toEqual({
          action: "continue",
          locale: defaultLocale,
          remember: null,
        });
        expect(
          decideLocale(
            request(null, { ...typed, "sec-purpose": "prefetch", "accept-language": other }),
          ),
        ).toEqual({ action: "continue", locale: defaultLocale, remember: null });
        expect(decideLocale(request(other, rsc, defaultLocale))).toEqual({
          action: "continue",
          locale: other,
          remember: null,
        });
      });

      it("POST se nepřesměruje", () => {
        expect(
          decideLocale(request(null, { ...typed, "accept-language": other }, null, "POST")),
        ).toEqual({ action: "continue", locale: defaultLocale, remember: null });
      });
    });
  }

  it("robot bez Accept-Language a bez cookie dostane výchozí jazyk bez přesměrování", () => {
    expect(decideLocale(request(null, { accept: "text/html" }))).toEqual({
      action: "continue",
      locale: defaultLocale,
      remember: null,
    });
    expect(decideLocale(request(null, typed))).toEqual({
      action: "continue",
      locale: defaultLocale,
      remember: null,
    });
  });

  it("prohlížeč ve výchozím jazyce zůstane a nic se neukládá", () => {
    expect(decideLocale(request(null, { ...typed, "accept-language": "cs-CZ,cs" }))).toEqual({
      action: "continue",
      locale: defaultLocale,
      remember: null,
    });
    expect(decideLocale(request(null, { ...clicked, "accept-language": "cs-CZ,cs" }))).toEqual({
      action: "continue",
      locale: defaultLocale,
      remember: null,
    });
  });

  it("nenabízený jazyk prohlížeče znamená výchozí jazyk", () => {
    expect(decideLocale(request(null, { ...typed, "accept-language": "de-DE,fr" }))).toEqual({
      action: "continue",
      locale: defaultLocale,
      remember: null,
    });
  });

  it("smyčka nevznikne: po přesměrování je adresa s předponou a dál se nepřesměruje", () => {
    const first = decideLocale(request(null, { ...typed, "accept-language": "en-GB" }));
    expect(first).toEqual({ action: "redirect", locale: "en" });
    expect(decideLocale(request("en", { ...typed, "accept-language": "en-GB" }))).toEqual({
      action: "continue",
      locale: "en",
      remember: null,
    });
  });
});
