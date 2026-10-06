import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1", "user-agent": "Mozilla/5.0 test" }),
}));
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => task() }));

async function load() {
  vi.resetModules();
  return (await import("./umami")).trackServerEvent;
}

describe("trackServerEvent", () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_UMAMI_URL", "https://analytics.example.test/");
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", "84f5dce1-4f91-4dc9-b8be-a62218153697");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("pošle událost s IP a User-Agentem návštěvníka", async () => {
    const track = await load();
    await track({ name: "site-published", url: "/vytvorit", data: { template: "statek" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://analytics.example.test/api/send");
    const { type, payload } = JSON.parse(init.body);
    expect(type).toBe("event");
    expect(payload).toMatchObject({
      name: "site-published",
      ip: "198.51.100.7",
      userAgent: "Mozilla/5.0 test",
      data: { template: "statek" },
    });
  });

  it("bez požadavku nepošle IP a použije prohlížečový User-Agent", async () => {
    const track = await load();
    await track({ name: "rsvp-completed", fromRequest: false });
    const { payload } = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.ip).toBeUndefined();
    expect(payload.userAgent).toContain("Mozilla/5.0");
  });

  it("zahodí neplatný název a nehází při chybě sítě", async () => {
    const track = await load();
    await track({ name: "-bad" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRejectedValue(new Error("síť"));
    await expect(track({ name: "ok-name" })).resolves.toBeUndefined();
  });

  it("bez URL a ID nic neposílá", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_URL", "");
    const track = await load();
    await track({ name: "ok-name" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
