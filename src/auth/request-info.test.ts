import { describe, expect, it } from "vitest";
import { clientIp, isSameOrigin, pickLocale } from "./request-info";

const headers = (values: Record<string, string>) => (name: string) => values[name];

describe("clientIp", () => {
  it("na Vercelu bere hlavičku platformy a ignoruje podvržený x-forwarded-for", () => {
    expect(
      clientIp(
        headers({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "1.1.1.1" }),
        true,
      ),
    ).toBe("203.0.113.7");
    expect(clientIp(headers({ "x-real-ip": "203.0.113.8" }), true)).toBe("203.0.113.8");
  });

  it("mimo Vercel čte první adresu z x-forwarded-for", () => {
    expect(clientIp(headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }), false)).toBe(
      "198.51.100.1",
    );
  });

  it("bez hlavičky nebo s nesmyslně dlouhou hodnotou vrátí unknown", () => {
    expect(clientIp(headers({}), true)).toBe("unknown");
    expect(clientIp(headers({ "x-forwarded-for": "x".repeat(100) }), false)).toBe("unknown");
    expect(clientIp(headers({ "x-forwarded-for": "" }), false)).toBe("unknown");
  });
});

describe("isSameOrigin", () => {
  it("souhlasí, když host původu odpovídá hostiteli požadavku", () => {
    expect(isSameOrigin("https://app.se-vezmou.cz", "app.se-vezmou.cz", null)).toBe(true);
    expect(isSameOrigin("http://app.localhost:3100", "app.localhost:3100", null)).toBe(true);
  });

  it("přednost má X-Forwarded-Host", () => {
    expect(isSameOrigin("https://app.se-vezmou.cz", "interni-host", "app.se-vezmou.cz")).toBe(true);
    expect(isSameOrigin("https://app.se-vezmou.cz", "app.se-vezmou.cz", "jiny.cz")).toBe(false);
  });

  it("odmítne cizí původ, jiný port, chybějící a nesmyslný Origin", () => {
    expect(isSameOrigin("https://evil.example", "app.se-vezmou.cz", null)).toBe(false);
    expect(isSameOrigin("https://klara-a-matej.se-vezmou.cz", "app.se-vezmou.cz", null)).toBe(
      false,
    );
    expect(isSameOrigin("http://app.localhost:3000", "app.localhost:3100", null)).toBe(false);
    expect(isSameOrigin(null, "app.se-vezmou.cz", null)).toBe(false);
    expect(isSameOrigin("null", "app.se-vezmou.cz", null)).toBe(false);
    expect(isSameOrigin("není url", "app.se-vezmou.cz", null)).toBe(false);
    expect(isSameOrigin("https://app.se-vezmou.cz", null, null)).toBe(false);
  });
});

describe("pickLocale", () => {
  it("čeština je výchozí", () => {
    expect(pickLocale(null)).toBe("cs");
    expect(pickLocale("")).toBe("cs");
    expect(pickLocale("de-DE,fr;q=0.8")).toBe("cs");
  });

  it("angličtina jen když je upřednostněna", () => {
    expect(pickLocale("en-GB,en;q=0.9")).toBe("en");
    expect(pickLocale("en-US")).toBe("en");
    expect(pickLocale("cs-CZ,cs;q=0.9,en;q=0.8")).toBe("cs");
    expect(pickLocale("en;q=0.5,cs;q=0.9")).toBe("cs");
    expect(pickLocale("de,en;q=0.5")).toBe("en");
  });

  it("ignoruje jazyky s q=0 a nesmyslné hodnoty", () => {
    expect(pickLocale("en;q=0,cs;q=0.1")).toBe("cs");
    expect(pickLocale("en;q=abc")).toBe("cs");
  });
});
