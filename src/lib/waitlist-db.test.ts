import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
  process.env.AUTH_SECRET = "auth-secret-auth-secret-auth-secret-1";
});

import { setTransport } from "@/lib/db/rpc";
import type { RpcTransport } from "@/lib/db/transport";
import { dbWaitlistDeps as realDeps, waitlistConfirmLink } from "./waitlist-db";
import { submitWaitlist, WAITLIST_CONSENT_VERSION } from "./waitlist";

type Call = { fn: string; args: Record<string, unknown> };

/** Falešná doprava: pamatuje si e-maily jako databáze s unikátním klíčem a počítá hity omezení. */
function fakeDatabase(limit = 10) {
  const calls: Call[] = [];
  const emails = new Set<string>();
  const hits = new Map<string, number>();
  const transport: RpcTransport = {
    async call(fn, args) {
      calls.push({ fn, args });
      if (fn === "waitlist_add") {
        const email = String(args.p_email).toLowerCase();
        const created = !emails.has(email);
        emails.add(email);
        return created;
      }
      if (fn === "rate_limit_hit") {
        const key = String(args.p_bucket_key);
        const count = (hits.get(key) ?? 0) + 1;
        hits.set(key, count);
        return [{ allowed: count <= limit, retry_after: count <= limit ? 0 : 60 }];
      }
      throw new Error(`neočekávaná funkce ${fn}`);
    },
  };
  setTransport(transport);
  return { calls, emails, hits };
}

afterEach(() => {
  setTransport(null);
});

/** Odložené úlohy (e-mail s odkazem) se jen sbírají; v testu se nic neposílá. */
let deferred: (() => Promise<unknown>)[] = [];
function dbWaitlistDeps() {
  deferred = [];
  return realDeps((task) => {
    deferred.push(task);
  });
}

const valid = { email: " Klara@Example.COM ", consent: "on", locale: "en" };

describe("čekací listina nad databází", () => {
  it("uloží normalizovaný e-mail, jazyk a verzi textu souhlasu přes waitlist_add", async () => {
    const db = fakeDatabase();
    const result = await submitWaitlist(valid, dbWaitlistDeps());
    expect(result).toEqual({ status: "success" });
    expect(db.calls).toEqual([
      {
        fn: "waitlist_add",
        args: {
          p_email: "klara@example.com",
          p_locale: "en",
          p_consent_text_version: WAITLIST_CONSENT_VERSION,
          // v databázi je jen otisk jednorázového tokenu (SHA-256), ne token
          p_token_hash: expect.any(Buffer),
        },
      },
    ]);
  });

  it("double opt-in: nový zápis odloží e-mail s odkazem, opakovaný bez nového odkazu ho nepošle", async () => {
    const db = fakeDatabase();
    await submitWaitlist(valid, dbWaitlistDeps());
    expect(deferred).toHaveLength(1);
    const hash = db.calls[0].args.p_token_hash as Buffer;
    expect(hash).toHaveLength(32);
    await submitWaitlist(valid, dbWaitlistDeps());
    expect(deferred).toHaveLength(0);
    // odkaz vede na stránku potvrzení v jazyce zápisu a nese token (ne jeho otisk)
    const link = waitlistConfirmLink({ locale: "en" }, "a".repeat(43));
    expect(link).toMatch(/\/en\/waitlist\/confirm\?t=a{43}$/);
  });

  it("stejný e-mail podruhé: stejná odpověď, žádné prozrazení, jediný záznam", async () => {
    const db = fakeDatabase();
    const first = await submitWaitlist(valid, dbWaitlistDeps());
    const second = await submitWaitlist({ ...valid, email: "KLARA@example.com" }, dbWaitlistDeps());
    expect(second).toEqual(first);
    expect(db.emails.size).toBe(1);
  });

  it("omezení počtu požadavků: klíč je HMAC (bez IP), po limitu rateLimited a nic se neuloží", async () => {
    const db = fakeDatabase(2);
    const input = { ...valid, clientKey: "203.0.113.7" };
    expect(await submitWaitlist(input, dbWaitlistDeps())).toEqual({ status: "success" });
    expect(await submitWaitlist(input, dbWaitlistDeps())).toEqual({ status: "success" });
    expect(await submitWaitlist(input, dbWaitlistDeps())).toEqual({ status: "rateLimited" });

    const limitCalls = db.calls.filter((call) => call.fn === "rate_limit_hit");
    expect(limitCalls).toHaveLength(3);
    const key = String(limitCalls[0].args.p_bucket_key);
    expect(key.startsWith("waitlist-ip:")).toBe(true);
    expect(key).not.toContain("203.0.113.7");
    expect(db.calls.filter((call) => call.fn === "waitlist_add")).toHaveLength(2);
  });

  it("jiná IP má vlastní čítač", async () => {
    const db = fakeDatabase(1);
    await submitWaitlist({ ...valid, clientKey: "198.51.100.1" }, dbWaitlistDeps());
    const other = await submitWaitlist(
      { ...valid, email: "jiny@example.com", clientKey: "198.51.100.2" },
      dbWaitlistDeps(),
    );
    expect(other).toEqual({ status: "success" });
    expect(db.hits.size).toBe(2);
  });

  it("selhání databáze: chyba bez e-mailu v logu", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setTransport({
      async call() {
        throw new Error("spojení selhalo pro klara@example.com");
      },
    });
    const result = await submitWaitlist(valid, dbWaitlistDeps());
    expect(result).toEqual({ status: "error" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("klara@example.com");
  });
});
