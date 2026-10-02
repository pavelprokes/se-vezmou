import { describe, expect, it } from "vitest";
import { appOrigin, siteHostname } from "./app-origin";

const prod = { rootDomains: ["se-vezmou.cz"] };
const local = { rootDomains: ["localhost"] };

describe("appOrigin", () => {
  it("v ostrém provozu vede na https://app.se-vezmou.cz", () => {
    expect(appOrigin("app.se-vezmou.cz", prod)).toBe("https://app.se-vezmou.cz");
  });

  it("lokálně zachová port a schéma http", () => {
    expect(appOrigin("app.localhost:3100", local)).toBe("http://app.localhost:3100");
  });

  it("hlavičku Host, která není hostitel app, nikdy nepoužije (odkaz v e-mailu)", () => {
    expect(appOrigin("evil.example", prod)).toBe("https://app.se-vezmou.cz");
    expect(appOrigin("klara-a-matej.se-vezmou.cz", prod)).toBe("https://app.se-vezmou.cz");
    expect(appOrigin("admin.se-vezmou.cz", prod)).toBe("https://app.se-vezmou.cz");
    expect(appOrigin(null, prod)).toBe("https://app.se-vezmou.cz");
  });
});

describe("siteHostname", () => {
  it("složí adresu webu páru", () => {
    expect(siteHostname("klara-a-matej", prod)).toBe("klara-a-matej.se-vezmou.cz");
  });
});
