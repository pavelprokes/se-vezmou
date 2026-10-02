import { describe, expect, it } from "vitest";
import {
  hostConfigFromEnv,
  isValidSlug,
  normalizeHost,
  resolveHost,
  type HostConfig,
} from "./resolve";

const prod: HostConfig = { rootDomains: ["se-vezmou.cz"] };
const local: HostConfig = { rootDomains: ["localhost"] };

describe("normalizeHost", () => {
  it("odstraní port, velká písmena a tečku na konci", () => {
    expect(normalizeHost("App.Se-Vezmou.CZ:3000")).toBe("app.se-vezmou.cz");
    expect(normalizeHost("se-vezmou.cz.")).toBe("se-vezmou.cz");
  });

  it("odmítne prázdné a podezřelé hodnoty", () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("evil.com/path")).toBeNull();
    expect(normalizeHost("a..b")).toBeNull();
    expect(normalizeHost("[::1]:3000")).toBeNull();
  });
});

describe("isValidSlug", () => {
  it.each(["klara-a-matej", "a", "x1", "svatba2027"])("platný slug %s", (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each([
    "",
    "-klara",
    "klara-",
    "kl--ara",
    "Klara",
    "klára",
    "kl.ara",
    "a".repeat(64),
    "www",
    "app",
    "admin",
    "api",
    "mail",
    "podpora",
    "status",
    "static",
    "cdn",
  ])("neplatný slug %j", (slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });

  it("přijme slug dlouhý 63 znaků", () => {
    expect(isValidSlug("a".repeat(63))).toBe(true);
  });
});

describe("resolveHost: produkce", () => {
  it("rozpozná pět tříd hostitelů", () => {
    expect(resolveHost("se-vezmou.cz", prod)).toEqual({ kind: "marketing" });
    expect(resolveHost("app.se-vezmou.cz", prod)).toEqual({ kind: "app" });
    expect(resolveHost("admin.se-vezmou.cz", prod)).toEqual({ kind: "admin" });
    expect(resolveHost("klara-a-matej.se-vezmou.cz", prod)).toEqual({
      kind: "tenant",
      slug: "klara-a-matej",
    });
    expect(resolveHost("neznamy.example.com", prod)).toEqual({ kind: "invalid" });
  });

  it("www je úvodní stránka a nepřesměrovává (o hlavním jménu rozhoduje Vercel, jinak smyčka)", () => {
    expect(resolveHost("www.se-vezmou.cz", prod)).toEqual({ kind: "marketing" });
  });

  it("víceúrovňové subdomény, rezervovaná slova a neplatné štítky jsou neplatné", () => {
    expect(resolveHost("a.b.se-vezmou.cz", prod)).toEqual({ kind: "invalid" });
    expect(resolveHost("app.klara.se-vezmou.cz", prod)).toEqual({ kind: "invalid" });
    expect(resolveHost("api.se-vezmou.cz", prod)).toEqual({ kind: "invalid" });
    expect(resolveHost("kl--ara.se-vezmou.cz", prod)).toEqual({ kind: "invalid" });
    expect(resolveHost("xse-vezmou.cz", prod)).toEqual({ kind: "invalid" });
    expect(resolveHost("se-vezmou.cz.evil.com", prod)).toEqual({ kind: "invalid" });
  });

  it("chybějící hlavička Host je neplatná", () => {
    expect(resolveHost(undefined, prod)).toEqual({ kind: "invalid" });
  });
});

describe("resolveHost: lokálně přes *.localhost", () => {
  it("localhost a jeho subdomény", () => {
    expect(resolveHost("localhost:3000", local)).toEqual({ kind: "marketing" });
    expect(resolveHost("app.localhost:3000", local)).toEqual({ kind: "app" });
    expect(resolveHost("admin.localhost:3000", local)).toEqual({ kind: "admin" });
    expect(resolveHost("klara-a-matej.localhost:3000", local)).toEqual({
      kind: "tenant",
      slug: "klara-a-matej",
    });
  });
});

describe("hostConfigFromEnv", () => {
  it("výchozí kořenová doména je se-vezmou.cz", () => {
    expect(hostConfigFromEnv({})).toEqual({
      rootDomains: ["se-vezmou.cz"],
      preset: undefined,
      previewTenantSlug: undefined,
    });
  });

  it("ve vývoji se vždy přidá localhost", () => {
    expect(hostConfigFromEnv({}, { development: true }).rootDomains).toEqual([
      "se-vezmou.cz",
      "localhost",
    ]);
    expect(
      hostConfigFromEnv({ ROOT_DOMAIN: "localhost" }, { development: true }).rootDomains,
    ).toEqual(["localhost"]);
  });

  it("náhled na *.vercel.app používá předvolbu mimo kořenovou doménu", () => {
    const config = hostConfigFromEnv({
      VERCEL_ENV: "preview",
      HOST_PRESET: "app",
    });
    expect(resolveHost("se-vezmou-git-x.vercel.app", config)).toEqual({ kind: "app" });
    // Kořenová doména se řídí vždy pravidly, předvolba je nepřebije.
    expect(resolveHost("admin.se-vezmou.cz", config)).toEqual({ kind: "admin" });
  });

  it("předvolba tenant potřebuje platný slug", () => {
    const ok = hostConfigFromEnv({
      VERCEL_ENV: "preview",
      HOST_PRESET: "tenant",
      PREVIEW_TENANT_SLUG: "klara-a-matej",
    });
    expect(resolveHost("x.vercel.app", ok)).toEqual({ kind: "tenant", slug: "klara-a-matej" });

    const bad = hostConfigFromEnv({
      VERCEL_ENV: "preview",
      HOST_PRESET: "tenant",
      PREVIEW_TENANT_SLUG: "Špatný slug",
    });
    expect(resolveHost("x.vercel.app", bad)).toEqual({ kind: "invalid" });
  });

  it("produkce předvolby nikdy nečte", () => {
    const config = hostConfigFromEnv({
      VERCEL_ENV: "production",
      HOST_PRESET: "admin",
      PREVIEW_TENANT_SLUG: "klara-a-matej",
    });
    expect(config.preset).toBeUndefined();
    expect(config.previewTenantSlug).toBeUndefined();
    expect(resolveHost("se-vezmou-abc.vercel.app", config)).toEqual({ kind: "invalid" });
  });

  it("neplatná předvolba se ignoruje", () => {
    const config = hostConfigFromEnv({ VERCEL_ENV: "preview", HOST_PRESET: "operator" });
    expect(config.preset).toBeUndefined();
  });
});
