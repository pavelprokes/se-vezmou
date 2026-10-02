import { describe, expect, it } from "vitest";
import type { HostConfig } from "@/host/resolve";
import { appOriginForAdminHost, siteOriginForAdminHost } from "./urls";

const production: HostConfig = { rootDomains: ["se-vezmou.cz"] };
const local: HostConfig = { rootDomains: ["localhost"] };

describe("adresy odvozené z hostitele administrace", () => {
  it("z admin.se-vezmou.cz vznikne app.se-vezmou.cz a adresa webu páru", () => {
    expect(appOriginForAdminHost("admin.se-vezmou.cz", production)).toBe(
      "https://app.se-vezmou.cz",
    );
    expect(siteOriginForAdminHost("klara-a-matej", "admin.se-vezmou.cz", production)).toBe(
      "https://klara-a-matej.se-vezmou.cz",
    );
  });

  it("lokálně zachová schéma http a port", () => {
    expect(appOriginForAdminHost("admin.localhost:3100", local)).toBe("http://app.localhost:3100");
    expect(siteOriginForAdminHost("klara-a-matej", "admin.localhost:3100", local)).toBe(
      "http://klara-a-matej.localhost:3100",
    );
  });

  it("hostitele, který není admin, nikdy nepřevezme (odkaz míří na kořenovou doménu z nastavení)", () => {
    expect(appOriginForAdminHost("zlo.example.com", production)).toBe("https://app.se-vezmou.cz");
    expect(appOriginForAdminHost("app.se-vezmou.cz", production)).toBe("https://app.se-vezmou.cz");
    expect(appOriginForAdminHost("tenant.se-vezmou.cz", production)).toBe(
      "https://app.se-vezmou.cz",
    );
    expect(appOriginForAdminHost(null, production)).toBe("https://app.se-vezmou.cz");
    expect(appOriginForAdminHost("admin.se-vezmou.cz.zlo.cz", production)).toBe(
      "https://app.se-vezmou.cz",
    );
  });
});
