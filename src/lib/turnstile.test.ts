import { afterEach, describe, expect, it, vi } from "vitest";

async function load(secret: string | undefined) {
  vi.resetModules();
  if (secret) vi.stubEnv("TURNSTILE_SECRET_KEY", secret);
  else vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  return import("./turnstile");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const reply = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response);

describe("Cloudflare Turnstile", () => {
  it("bez tajného klíče se ověření přeskočí", async () => {
    const { verifyTurnstile } = await load(undefined);
    const fetchImpl = reply({ success: true });
    expect(await verifyTurnstile("", "1.2.3.4", fetchImpl)).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("platný token projde, neplatný nebo chybějící je robot", async () => {
    const { verifyTurnstile } = await load("tajny-klic");
    const ok = reply({ success: true });
    expect(await verifyTurnstile("token", "1.2.3.4", ok)).toBe("ok");
    const body = (ok.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("secret")).toBe("tajny-klic");
    expect(body.get("response")).toBe("token");
    expect(body.get("remoteip")).toBe("1.2.3.4");
    expect(await verifyTurnstile("token", null, reply({ success: false }))).toBe("bot");
    expect(await verifyTurnstile("", null, ok)).toBe("bot");
    expect(await verifyTurnstile(undefined, null, ok)).toBe("bot");
  });

  it("výpadek Cloudflare formulář nezablokuje (selže otevřeně)", async () => {
    const { verifyTurnstile } = await load("tajny-klic");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await verifyTurnstile("token", null, reply({}, false))).toBe("ok");
    const broken = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await verifyTurnstile("token", null, broken)).toBe("ok");
  });
});
