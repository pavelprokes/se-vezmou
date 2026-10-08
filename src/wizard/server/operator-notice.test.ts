import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET = "auth-secret-auth-secret-auth-secret-1";
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
});

import { setTransport } from "@/lib/db/rpc";

const INPUT = {
  weddingId: "11111111-1111-4111-8111-111111111111",
  slug: "klara-a-matej",
  siteUrl: "https://klara-a-matej.se-vezmou.cz/",
  template: "statek",
  locale: "cs" as const,
};

function fakeDb(install: typeof setTransport, opts: { allowed?: boolean } = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  install({
    async call(fn, args) {
      calls.push({ fn, args });
      if (fn === "rate_limit_hit") return [{ allowed: opts.allowed ?? true, retry_after: 0 }];
      if (fn === "email_log_insert") return "55555555-5555-4555-8555-555555555555";
      if (fn === "email_log_set_status") return true;
      throw new Error(`Neočekávané volání ${fn}`);
    },
  });
  return calls;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  setTransport(null);
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** `env` si hodnoty ukládá do mezipaměti, proto se modul pro každý případ načte znovu. */
async function load(operatorEmail: string) {
  vi.stubEnv("OPERATOR_NOTIFY_EMAIL", operatorEmail);
  vi.resetModules();
  const rpc = await import("@/lib/db/rpc");
  const { notifyOperatorSitePublished } = await import("./operator-notice");
  return { notify: notifyOperatorSitePublished, setTransport: rpc.setTransport };
}

describe("notifyOperatorSitePublished", () => {
  it("bez OPERATOR_NOTIFY_EMAIL nic neposílá", async () => {
    const { notify, setTransport: install } = await load("");
    const calls = fakeDb(install);
    await notify(INPUT);
    expect(calls).toEqual([]);
  });

  it("s adresou pošle zprávu typu operator_notice a zapíše ji do email_log", async () => {
    const { notify, setTransport: install } = await load("pavel@example.test");
    const calls = fakeDb(install);
    await notify(INPUT);
    const insert = calls.find((c) => c.fn === "email_log_insert");
    expect(insert?.args).toMatchObject({
      p_type: "operator_notice",
      p_wedding_id: INPUT.weddingId,
      p_recipient_domain: "example.test",
    });
    expect(calls.find((c) => c.fn === "email_log_set_status")?.args.p_status).toBe("sent");
  });

  it("nad limit upozornění tiše přeskočí", async () => {
    const { notify, setTransport: install } = await load("pavel@example.test");
    const calls = fakeDb(install, { allowed: false });
    await notify(INPUT);
    expect(calls.map((c) => c.fn)).toEqual(["rate_limit_hit"]);
  });

  it("chyba nikdy nevyletí ven", async () => {
    const { notify, setTransport: install } = await load("pavel@example.test");
    install({
      async call() {
        throw new Error("db down");
      },
    });
    await expect(notify(INPUT)).resolves.toBeUndefined();
  });
});
