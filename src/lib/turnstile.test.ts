import { afterEach, describe, expect, it, vi } from "vitest";

async function load(secret: string, siteKey = "site-key") {
  vi.resetModules();
  vi.stubEnv("TURNSTILE_SECRET_KEY", secret);
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", siteKey);
  return import("./turnstile");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const reply = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response);

describe("Cloudflare Turnstile", () => {
  it("bez obou klíčů se ověření přeskočí (widget by se nevykreslil a token by nepřišel)", async () => {
    const fetchImpl = reply({ success: true });
    expect(await (await load("")).verifyTurnstile("", "1.2.3.4", "wizard", fetchImpl)).toBe(
      "skipped",
    );
    expect(await (await load("tajny", "")).verifyTurnstile("", null, "wizard", fetchImpl)).toBe(
      "skipped",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("platný token projde, neplatný, chybějící, příliš dlouhý nebo z jiného formuláře je robot", async () => {
    const { verifyTurnstile } = await load("tajny-klic");
    const ok = reply({ success: true, action: "wizard" });
    expect(await verifyTurnstile("token", "1.2.3.4", "wizard", ok)).toBe("ok");
    const body = (ok.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("secret")).toBe("tajny-klic");
    expect(body.get("response")).toBe("token");
    expect(body.get("remoteip")).toBe("1.2.3.4");
    expect(await verifyTurnstile("token", null, "waitlist", ok)).toBe("bot");
    const no = reply({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifyTurnstile("token", null, "wizard", no)).toBe("bot");
    expect(await verifyTurnstile("", null, "wizard", ok)).toBe("bot");
    expect(await verifyTurnstile(undefined, null, "wizard", ok)).toBe("bot");
    expect(await verifyTurnstile("x".repeat(2049), null, "wizard", ok)).toBe("bot");
  });

  it("výpadek Cloudflare ani chyba našeho nastavení formulář nezablokuje (selže otevřeně)", async () => {
    const { verifyTurnstile } = await load("tajny-klic");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await verifyTurnstile("token", null, "wizard", reply({}, false))).toBe("ok");
    const broken = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await verifyTurnstile("token", null, "wizard", broken)).toBe("ok");
    const badSecret = reply({ success: false, "error-codes": ["invalid-input-secret"] });
    expect(await verifyTurnstile("token", null, "wizard", badSecret)).toBe("ok");
    expect(JSON.stringify(log.mock.calls)).toContain("invalid-input-secret");
  });
});
