import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
});

vi.mock("@/auth/request", () => ({ getClientIp: async () => "203.0.113.7" }));

import { RATE_RULES } from "@/auth/config";
import { setTransport } from "@/lib/db/rpc";
import { isAddressFree } from "./free-address-state";

type Call = { fn: string; args: Record<string, unknown> };

function fakeDb(row: { available: boolean | null; reason: string; retry_after?: number } | Error) {
  const calls: Call[] = [];
  setTransport({
    async call(fn, args) {
      calls.push({ fn, args });
      if (row instanceof Error) throw row;
      return [{ retry_after: 0, ...row }];
    },
  });
  return calls;
}

afterEach(() => {
  setTransport(null);
});

describe("isAddressFree", () => {
  it("volná adresa: ptá se databáze s omezením podle IP (klíč je HMAC)", async () => {
    const calls = fakeDb({ available: true, reason: "ok" });
    expect(await isAddressFree("david-and-lil")).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.fn).toBe("check_slug");
    expect(call.args.p_slug).toBe("david-and-lil");
    expect(String(call.args.p_rate_key)).toMatch(/^free-address-ip:/);
    expect(String(call.args.p_rate_key)).not.toContain("203.0.113.7");
    expect(call.args.p_rate_limit).toBe(RATE_RULES.freeAddressIp.limit);
    expect(call.args.p_rate_window).toBe(`${RATE_RULES.freeAddressIp.windowSeconds} seconds`);
  });

  it("zabraná, rezervovaná i blokovaná adresa není volná", async () => {
    fakeDb({ available: false, reason: "unavailable" });
    expect(await isAddressFree("obsazena-adresa")).toBe(false);
  });

  it("po překročení limitu není volná (stejná 404, nic se neprozradí)", async () => {
    fakeDb({ available: null, reason: "rate_limited", retry_after: 30 });
    expect(await isAddressFree("limit-adresa")).toBe(false);
  });

  it("neplatný tvar a vyhrazená slova se do databáze neposílají", async () => {
    const calls = fakeDb({ available: true, reason: "ok" });
    for (const slug of ["", "ab", "Test", "test", "www", "app", "a--b", "x".repeat(64)]) {
      expect(await isAddressFree(slug), slug).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it("selhání databáze skončí jako 404, ne jako chyba", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fakeDb(new Error("db down"));
    expect(await isAddressFree("chyba-adresa")).toBe(false);
  });
});
