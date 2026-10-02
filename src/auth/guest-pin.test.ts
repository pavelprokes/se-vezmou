import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
  process.env.PIN_PEPPER = "pepper-pepper-pepper-pepper-pepper-0001";
});

import { setTransport } from "@/lib/db/rpc";
import type { RpcTransport } from "@/lib/db/transport";
import { GUEST_SESSION, PIN_LOCKOUT, RATE_RULES } from "./config";
import { unlockWithGuestPin } from "./guest-pin";
import { hashPin } from "./pin";

const PEPPER = process.env.PIN_PEPPER!;
const WEDDING = "11111111-1111-4111-8111-111111111111";
const SESSION = "33333333-3333-4333-8333-333333333333";
const PIN = "482915";

type Call = { fn: string; args: Record<string, unknown> };
type Handler = (args: Record<string, unknown>) => unknown;

function fakeDb(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const transport: RpcTransport = {
    async call(fn, args) {
      calls.push({ fn, args });
      const handler = handlers[fn];
      if (!handler) throw new Error(`Neočekávané volání ${fn}`);
      return handler(args);
    },
  };
  setTransport(transport);
  return {
    calls,
    of: (fn: string) => calls.filter((c) => c.fn === fn),
    names: () => calls.map((c) => c.fn),
  };
}

const allow: Handler = () => [{ allowed: true, retry_after: 0 }];
const free: Handler = () => [{ locked: false, retry_after: 0 }];
const failure =
  (locked: boolean, retryAfter = 0): Handler =>
  () => [{ locked, retry_after: retryAfter, level: locked ? 1 : 0, newly_locked: locked }];

async function handlers(extra: Record<string, Handler> = {}) {
  const pinHash = await hashPin(PIN, PEPPER);
  return {
    rate_limit_hit: allow,
    auth_lockout_state: free,
    auth_lockout_failure: failure(false),
    auth_lockout_reset: () => null,
    auth_pin_get: () => [
      { wedding_id: WEDDING, admin_id: null, pin_hash: pinHash, backup_email: "z@example.test" },
    ],
    auth_create_session: () => SESSION,
    ...extra,
  };
}

const input = { weddingId: WEDDING, slug: "klara-a-matej", pin: PIN, ip: "198.51.100.7" };

afterEach(() => setTransport(null));

describe("PIN hostů (FR-PRIV-2)", () => {
  it("správný PIN vydá relaci hosta s krátkou platností a vynuluje čítače", async () => {
    const db = fakeDb(await handlers());
    const result = await unlockWithGuestPin(input);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.sessionId).toBe(SESSION);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const create = db.of("auth_create_session")[0].args;
    expect(create).toMatchObject({
      p_kind: "guest_pin",
      p_wedding_id: WEDDING,
      p_subject_id: null,
      p_idle_seconds: GUEST_SESSION.idleSeconds,
      p_absolute_seconds: GUEST_SESSION.absoluteSeconds,
    });
    // v databázi jen SHA-256 tokenu, nikdy token
    expect(Buffer.from(create.p_token_hash as Buffer).toString("hex")).toBe(
      createHash("sha256").update(result.token).digest("hex"),
    );
    expect(db.of("auth_lockout_reset")).toHaveLength(2);
    expect(db.of("auth_lockout_failure")).toHaveLength(0);
  });

  it("platnost relace hosta je kratší než u správce: 6 hodin nečinnosti a 2 dny", () => {
    expect(GUEST_SESSION).toEqual({ idleSeconds: 6 * 3600, absoluteSeconds: 2 * 86_400 });
  });

  it("klíče omezení jsou HMAC: slug ani IP nejsou v databázi čitelné", async () => {
    const db = fakeDb(await handlers());
    await unlockWithGuestPin(input);
    // slug se předává jen funkci `auth_pin_get` (hledání PINu); klíče čítačů a pauz jsou HMAC
    const keyed = db.calls.filter((c) => "p_bucket_key" in c.args);
    expect(keyed.length).toBeGreaterThanOrEqual(5);
    const text = JSON.stringify(keyed);
    expect(text).not.toContain("klara-a-matej");
    expect(text).not.toContain("198.51.100.7");
    for (const call of keyed) {
      expect(String(call.args.p_bucket_key)).toMatch(/^pin-guest-[a-z-]+:[A-Za-z0-9_-]{43}$/);
    }
  });

  it("chybný PIN: chyba se počítá hostu (5 chyb) i celé svatbě (50 chyb), relace nevznikne", async () => {
    const db = fakeDb(await handlers());
    const result = await unlockWithGuestPin({ ...input, pin: "135790" });
    expect(result).toEqual({ status: "invalid" });
    expect(db.of("auth_create_session")).toHaveLength(0);
    const failures = db.of("auth_lockout_failure").map((c) => c.args);
    expect(failures).toHaveLength(2);
    expect(failures.map((f) => f.p_threshold).sort()).toEqual(
      [PIN_LOCKOUT.threshold, RATE_RULES.pinGuestWeddingFailures.limit].sort(),
    );
    expect(failures.every((f) => f.p_base_seconds === 900 && f.p_max_seconds === 86_400)).toBe(
      true,
    );
    expect(db.of("auth_lockout_reset")).toHaveLength(0);
  });

  it("pátá chyba spustí pauzu a vrací její délku", async () => {
    fakeDb(await handlers({ auth_lockout_failure: failure(true, 900) }));
    expect(await unlockWithGuestPin({ ...input, pin: "135790" })).toEqual({
      status: "locked",
      retryAfter: 900,
    });
  });

  it("pauza platí i pro správný PIN a PIN se v ní vůbec neověřuje", async () => {
    const db = fakeDb(
      await handlers({ auth_lockout_state: () => [{ locked: true, retry_after: 600 }] }),
    );
    expect(await unlockWithGuestPin(input)).toEqual({ status: "locked", retryAfter: 600 });
    expect(db.names()).not.toContain("auth_pin_get");
    expect(db.of("auth_create_session")).toHaveLength(0);
  });

  it("pauza celé svatby (50 chyb ze všech adres) zastaví i hosta, který chybu neudělal", async () => {
    let call = 0;
    const db = fakeDb(
      await handlers({
        // první dotaz je podle hosta a IP (volno), druhý podle svatby (pauza)
        auth_lockout_state: () =>
          ++call === 1
            ? [{ locked: false, retry_after: 0 }]
            : [{ locked: true, retry_after: 1200 }],
      }),
    );
    expect(await unlockWithGuestPin(input)).toEqual({ status: "locked", retryAfter: 1200 });
    expect(db.names()).not.toContain("auth_pin_get");
  });

  it("neexistující svatba nebo svatba bez PINu vrací totéž co chybný PIN a počítá chyby", async () => {
    const db = fakeDb(await handlers({ auth_pin_get: () => [] }));
    expect(await unlockWithGuestPin(input)).toEqual({ status: "invalid" });
    expect(db.of("auth_lockout_failure")).toHaveLength(2);
    expect(db.of("auth_create_session")).toHaveLength(0);
  });

  it("PIN jiné svatby nic neodemkne", async () => {
    const pinHash = await hashPin(PIN, PEPPER);
    const db = fakeDb(
      await handlers({
        auth_pin_get: () => [
          {
            wedding_id: "99999999-9999-4999-8999-999999999999",
            admin_id: null,
            pin_hash: pinHash,
            backup_email: "z@example.test",
          },
        ],
      }),
    );
    expect(await unlockWithGuestPin(input)).toEqual({ status: "invalid" });
    expect(db.of("auth_create_session")).toHaveLength(0);
  });

  it("PIN správy není PIN hostů: hash se čte s rolí guest a správcovská relace nevznikne", async () => {
    const db = fakeDb(await handlers());
    await unlockWithGuestPin(input);
    expect(db.of("auth_pin_get")[0].args).toEqual({ p_slug: "klara-a-matej", p_role: "guest" });
    expect(db.of("auth_create_session")[0].args.p_kind).toBe("guest_pin");
  });

  it("hrubý limit podle svatby a IP vrací limited a PIN se neověřuje", async () => {
    const db = fakeDb(
      await handlers({ rate_limit_hit: () => [{ allowed: false, retry_after: 1800 }] }),
    );
    expect(await unlockWithGuestPin(input)).toEqual({ status: "limited", retryAfter: 1800 });
    expect(db.names()).toEqual(["rate_limit_hit"]);
  });

  it("selhání úložiště omezení selže zavřeně: PIN se nepřijme", async () => {
    fakeDb(
      await handlers({
        rate_limit_hit: () => {
          throw new Error("databáze nejede");
        },
      }),
    );
    await expect(unlockWithGuestPin(input)).rejects.toThrow();
  });
});
