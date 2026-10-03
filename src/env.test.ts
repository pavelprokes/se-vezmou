import { afterEach, describe, expect, it, vi } from "vitest";

async function loadEnv(values: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  return import("./env");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("líné ověření proměnných prostředí", () => {
  it("špatná hodnota nerozbije import ani ostatní klíče", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env } = await loadEnv({ AUTH_SECRET: "x".repeat(31), R2_BUCKET: "bucket" });
    expect(env.R2_BUCKET).toBe("bucket");
    expect(error).not.toHaveBeenCalled();
  });

  it("kratší AUTH_SECRET selže teprve při použití, s jasnou zprávou a bez hodnoty", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, requireEnv } = await loadEnv({ AUTH_SECRET: "tajne-x".repeat(2) });
    expect(() => env.AUTH_SECRET).toThrow(/AUTH_SECRET/);
    expect(() => requireEnv("AUTH_SECRET")).toThrow(/AUTH_SECRET/);
    expect(JSON.stringify(error.mock.calls)).not.toContain("tajne-x");
    // zalogováno jen jednou
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("platná tajná hodnota projde", async () => {
    const { requireEnv } = await loadEnv({ AUTH_SECRET: "s".repeat(32) });
    expect(requireEnv("AUTH_SECRET")).toBe("s".repeat(32));
  });

  it("chybná veřejná adresa spadne na výchozí a zaloguje chybu", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env } = await loadEnv({ NEXT_PUBLIC_SITE_URL: "tohle neni adresa" });
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("https://se-vezmou.cz");
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("chybějící povinná hodnota při použití vyhodí chybu nasazení", async () => {
    const { requireEnv } = await loadEnv({ AUTH_SECRET: "" });
    expect(() => requireEnv("AUTH_SECRET")).toThrow(/Chybí proměnná prostředí AUTH_SECRET/);
  });

  it("prázdné řetězce se berou jako nenastavené", async () => {
    const { env } = await loadEnv({ ROOT_DOMAIN: "", HOST_PRESET: "" });
    expect(env.ROOT_DOMAIN).toBeUndefined();
    expect(env.HOST_PRESET).toBeUndefined();
  });
});
