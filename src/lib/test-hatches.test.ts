import { describe, expect, it } from "vitest";
import { devPagesEnabled } from "@/site/dev-gate";
import {
  activeTestHatches,
  assertTestHatchesSafe,
  hostPresetAllowed,
  isProductionLike,
  testHatchesAllowed,
} from "./test-hatches";

const PROD_BUILD = { NODE_ENV: "production" };
const PREVIEW = { NODE_ENV: "production", VERCEL_ENV: "preview" };
const VERCEL_PROD = { NODE_ENV: "production", VERCEL_ENV: "production" };

const HATCHES = {
  CRON_TEST_CLOCK: "1",
  EMAIL_TRANSPORT: "outbox",
  STORAGE_DRIVER: "memory",
  ENABLE_UI_CATALOG: "1",
  OG_FETCH_TEST_HOST: "fotky-test.example=127.0.0.1:4555",
  MAP_STUB: "1",
  HOST_PRESET: "admin",
};

describe("isProductionLike", () => {
  it("rozpozná produkční sestavení i ostrou produkci", () => {
    expect(isProductionLike({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionLike({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionLike({ NODE_ENV: "development" })).toBe(false);
    expect(isProductionLike({ NODE_ENV: "test" })).toBe(false);
    expect(isProductionLike({})).toBe(false);
  });
});

describe("testHatchesAllowed", () => {
  it("ve vývoji a testech fungují vždy", () => {
    expect(testHatchesAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(testHatchesAllowed({ NODE_ENV: "test" })).toBe(true);
  });

  it("žádná vrátka nefungují v produkčním sestavení bez ALLOW_TEST_HATCHES=1", () => {
    expect(testHatchesAllowed(PROD_BUILD)).toBe(false);
    expect(testHatchesAllowed(PREVIEW)).toBe(false);
    expect(testHatchesAllowed({ ...PROD_BUILD, ALLOW_TEST_HATCHES: "true" })).toBe(false);
    expect(testHatchesAllowed({ ...PROD_BUILD, ALLOW_TEST_HATCHES: "1" })).toBe(true);
  });

  it("v ostré produkci nefungují ani s opt-in", () => {
    expect(testHatchesAllowed(VERCEL_PROD)).toBe(false);
    expect(testHatchesAllowed({ ...VERCEL_PROD, ALLOW_TEST_HATCHES: "1" })).toBe(false);
    expect(testHatchesAllowed({ VERCEL_ENV: "production", ALLOW_TEST_HATCHES: "1" })).toBe(false);
  });
});

describe("katalog UI a vývojářské stránky", () => {
  it("v produkčním sestavení jen s ENABLE_UI_CATALOG=1 a opt-in", () => {
    const catalog = { ENABLE_UI_CATALOG: "1" };
    expect(devPagesEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(devPagesEnabled(PROD_BUILD)).toBe(false);
    expect(devPagesEnabled({ ...PROD_BUILD, ...catalog })).toBe(false);
    expect(devPagesEnabled({ ...PROD_BUILD, ...catalog, ALLOW_TEST_HATCHES: "1" })).toBe(true);
    expect(devPagesEnabled({ ...VERCEL_PROD, ...catalog, ALLOW_TEST_HATCHES: "1" })).toBe(false);
  });
});

describe("hostPresetAllowed", () => {
  it("marketing smí na náhledu, app a admin nikdy v produkčním sestavení", () => {
    expect(hostPresetAllowed("marketing", PREVIEW)).toBe(true);
    expect(hostPresetAllowed("marketing", VERCEL_PROD)).toBe(false);
    for (const preset of ["app", "admin"]) {
      expect(hostPresetAllowed(preset, { NODE_ENV: "development" })).toBe(true);
      expect(hostPresetAllowed(preset, PREVIEW)).toBe(false);
      expect(hostPresetAllowed(preset, { ...PREVIEW, ALLOW_TEST_HATCHES: "1" })).toBe(false);
    }
    expect(hostPresetAllowed("tenant", PREVIEW)).toBe(false);
    expect(hostPresetAllowed("tenant", { ...PREVIEW, ALLOW_TEST_HATCHES: "1" })).toBe(true);
    expect(hostPresetAllowed("operator", { NODE_ENV: "development" })).toBe(false);
  });
});

describe("assertTestHatchesSafe: nastavená vrátka nejsou tiše ignorována", () => {
  it("vypíše všechna aktivní vrátka", () => {
    expect(activeTestHatches(HATCHES)).toHaveLength(7);
    expect(activeTestHatches({ HOST_PRESET: "marketing", EMAIL_TRANSPORT: "ses" })).toEqual([]);
  });

  it("v produkčním sestavení bez opt-in selže a jmenuje vrátka", () => {
    expect(() => assertTestHatchesSafe({ ...PROD_BUILD, ...HATCHES })).toThrow(/CRON_TEST_CLOCK/);
    for (const [key, value] of Object.entries(HATCHES)) {
      expect(() => assertTestHatchesSafe({ ...PROD_BUILD, [key]: value })).toThrow(
        /ALLOW_TEST_HATCHES/,
      );
    }
  });

  it("s opt-in projdou vrátka e2e, ne však předvolba admin", () => {
    const rest: Record<string, string> = { ...HATCHES };
    delete rest.HOST_PRESET;
    expect(() =>
      assertTestHatchesSafe({ ...PROD_BUILD, ...rest, ALLOW_TEST_HATCHES: "1" }),
    ).not.toThrow();
    expect(() =>
      assertTestHatchesSafe({ ...PROD_BUILD, HOST_PRESET: "admin", ALLOW_TEST_HATCHES: "1" }),
    ).toThrow(/HOST_PRESET=admin/);
  });

  it("v ostré produkci selže i samotné ALLOW_TEST_HATCHES=1", () => {
    expect(() => assertTestHatchesSafe({ ...VERCEL_PROD, ALLOW_TEST_HATCHES: "1" })).toThrow(
      /ostré produkci/,
    );
    expect(() => assertTestHatchesSafe({ ...VERCEL_PROD, EMAIL_TRANSPORT: "outbox" })).toThrow(
      /EMAIL_TRANSPORT=outbox/,
    );
  });

  it("čistá produkce, předvolba marketing a vývoj projdou", () => {
    expect(() => assertTestHatchesSafe(VERCEL_PROD)).not.toThrow();
    expect(() => assertTestHatchesSafe({ ...PREVIEW, HOST_PRESET: "marketing" })).not.toThrow();
    expect(() => assertTestHatchesSafe({ NODE_ENV: "development", ...HATCHES })).not.toThrow();
  });
});
