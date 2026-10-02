import { describe, expect, it } from "vitest";
import { displayHost, previewUrl, siteUrl, tenantOrigin } from "./urls";

describe("tenantOrigin", () => {
  it("ostrý provoz: https a doména z hostitele app", () => {
    expect(tenantOrigin("klara-a-matej", "app.se-vezmou.cz")).toBe(
      "https://klara-a-matej.se-vezmou.cz",
    );
  });

  it("lokálně: http, *.localhost a port", () => {
    expect(tenantOrigin("klara-a-matej", "app.localhost:3100")).toBe(
      "http://klara-a-matej.localhost:3100",
    );
    expect(tenantOrigin("klara-a-matej", "APP.Localhost")).toBe("http://klara-a-matej.localhost");
  });

  it("hostitel, který není app, ani chybějící hlavička se nikdy nepoužije: záložní doména", () => {
    expect(tenantOrigin("a-b", "evil.example")).toBe("https://a-b.se-vezmou.cz");
    expect(tenantOrigin("a-b", "klara-a-matej.se-vezmou.cz")).toBe("https://a-b.se-vezmou.cz");
    expect(tenantOrigin("a-b", null)).toBe("https://a-b.se-vezmou.cz");
    expect(tenantOrigin("a-b", "app.evil.example/x")).toBe("https://a-b.se-vezmou.cz");
    expect(tenantOrigin("a-b", undefined, "example.cz")).toBe("https://a-b.example.cz");
  });
});

describe("siteUrl, previewUrl, displayHost", () => {
  it("úvodní stránka webu česky a anglicky", () => {
    expect(siteUrl("klara-a-matej", "app.se-vezmou.cz")).toBe(
      "https://klara-a-matej.se-vezmou.cz/",
    );
    expect(siteUrl("klara-a-matej", "app.se-vezmou.cz", "en")).toBe(
      "https://klara-a-matej.se-vezmou.cz/en",
    );
  });

  it("odkaz na náhled nese token v cestě, česky i anglicky", () => {
    const token = "A".repeat(43);
    expect(previewUrl("klara-a-matej", token, "app.localhost:3100")).toBe(
      `http://klara-a-matej.localhost:3100/nahled/${token}`,
    );
    expect(previewUrl("klara-a-matej", token, "app.se-vezmou.cz", "en")).toBe(
      `https://klara-a-matej.se-vezmou.cz/en/nahled/${token}`,
    );
  });

  it("adresa pro popisky a tisk je bez schématu", () => {
    expect(displayHost("klara-a-matej", "app.se-vezmou.cz")).toBe("klara-a-matej.se-vezmou.cz");
    expect(displayHost("klara-a-matej", "app.localhost:3100")).toBe("klara-a-matej.localhost:3100");
  });
});
