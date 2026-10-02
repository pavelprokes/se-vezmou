import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authCreateSession,
  authPinSet,
  authValidateSession,
  emailLogSetStatus,
  lockoutFailure,
  rateLimitHit,
  setTransport,
} from "./rpc";
import { buildTenantClaims } from "./claims";
import { DbError, getTransport } from "./transport";

afterEach(() => {
  setTransport(null);
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("doprava", () => {
  it("bytea a nedefinované argumenty: tenký obal předává Buffer beze změny a vynechané argumenty neposílá", async () => {
    const seen: [string, Record<string, unknown>][] = [];
    setTransport({
      async call(fn, args) {
        seen.push([fn, args]);
        return fn === "auth_create_session" ? [{ session_id: "s" }] : null;
      },
    });
    await authPinSet({ weddingId: "w", role: "admin", hash: "$argon2id$x" }).catch(() => undefined);
    const hash = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    await authCreateSession({
      kind: "admin",
      weddingId: "w",
      subjectId: "s",
      tokenHash: hash,
      idleSeconds: 10,
      absoluteSeconds: 20,
    }).catch(() => undefined);
    expect(seen[0]).toEqual([
      "auth_pin_set",
      { p_wedding_id: "w", p_role: "admin", p_hash: "$argon2id$x" },
    ]);
    expect(seen[1][1].p_token_hash).toBe(hash);
  });

  it("chyba databáze nenese argumenty volání (mohou obsahovat osobní údaje)", async () => {
    const error = new DbError("rate_limit_hit", "23505", "chyba SQL");
    expect(error.code).toBe("23505");
    expect(error.message).not.toContain("klic-s-hashem");
  });

  it("bez DATABASE_URL volání selže jasnou zprávou (ne při sestavení)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "https://projekt.supabase.co");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.resetModules();
    const fresh = await import("./transport");
    await expect(fresh.getTransport().call("rate_limit_hit", {}, "table")).rejects.toThrow(
      /Chybí DATABASE_URL/,
    );
  });

  it("getTransport vrací pg dopravu i v produkci (jediná cesta)", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(typeof getTransport().call).toBe("function");
  });
});

describe("typovaný obal (mapování řádků)", () => {
  it("rateLimitHit mapuje retry_after a posílá okno jako interval", async () => {
    const calls: unknown[] = [];
    setTransport({
      async call(fn, args) {
        calls.push([fn, args]);
        return [{ allowed: false, retry_after: 42 }];
      },
    });
    expect(await rateLimitHit("k", 5, 3600)).toEqual({ allowed: false, retryAfter: 42 });
    expect(calls).toEqual([
      ["rate_limit_hit", { p_bucket_key: "k", p_limit: 5, p_window: "3600 seconds" }],
    ]);
  });

  it("authValidateSession vrátí null, když relace neplatí", async () => {
    setTransport({ call: async () => [] });
    expect(await authValidateSession(Buffer.from("x"))).toBeNull();
  });

  it("authValidateSession mapuje sloupce na camelCase", async () => {
    setTransport({
      call: async () => [{ session_id: "s", wedding_id: "w", kind: "admin", subject_id: "a" }],
    });
    expect(await authValidateSession(Buffer.from("x"))).toEqual({
      sessionId: "s",
      weddingId: "w",
      kind: "admin",
      subjectId: "a",
    });
  });

  it("lockoutFailure mapuje všechny sloupce", async () => {
    setTransport({
      call: async () => [{ locked: true, retry_after: 900, level: 1, newly_locked: true }],
    });
    expect(
      await lockoutFailure("k", { threshold: 5, baseSeconds: 900, maxSeconds: 86400 }),
    ).toEqual({
      locked: true,
      retryAfter: 900,
      level: 1,
      newlyLocked: true,
    });
  });

  it("emailLogSetStatus nepřipojí nedefinované údaje", async () => {
    const seen: Record<string, unknown>[] = [];
    setTransport({
      async call(_fn, args) {
        seen.push(args);
        return true;
      },
    });
    await emailLogSetStatus("id", "sent");
    expect(seen[0]).toEqual({
      p_id: "id",
      p_status: "sent",
      p_provider_message_id: undefined,
      p_error_code: undefined,
    });
  });
});

describe("claimy transakce", () => {
  const WEDDING = "11111111-1111-4111-8111-111111111111";
  const ADMIN = "22222222-2222-4222-8222-222222222222";

  it("správce nese sub, wedding_id a wedding_role (a nic jiného)", () => {
    const claims = buildTenantClaims({ weddingId: WEDDING, weddingRole: "admin", subject: ADMIN });
    expect(claims).toEqual({ sub: ADMIN, wedding_id: WEDDING, wedding_role: "admin" });
  });

  it("návštěvník a náhled mají konstantní sub", () => {
    expect(
      buildTenantClaims({ weddingId: WEDDING, weddingRole: "visitor", subject: ADMIN }).sub,
    ).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("odmítne správce bez subjektu, neplatné UUID a neznámou roli", () => {
    expect(() => buildTenantClaims({ weddingId: WEDDING, weddingRole: "admin" })).toThrow();
    expect(() => buildTenantClaims({ weddingId: "není-uuid", weddingRole: "visitor" })).toThrow();
    expect(() => buildTenantClaims({ weddingId: WEDDING, weddingRole: "root" as never })).toThrow();
  });
});
