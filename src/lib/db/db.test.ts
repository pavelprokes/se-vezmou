import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projekt.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-service-role-key";
  process.env.SUPABASE_JWT_SECRET = "jwt-secret-jwt-secret-jwt-secret-jwt-1";
});

const rpcMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn(() => ({ rpc: rpcMock, from: vi.fn() })));
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

import {
  authCreateSession,
  authPinSet,
  authValidateSession,
  emailLogSetStatus,
  lockoutFailure,
  rateLimitHit,
  setTransport,
} from "./rpc";
import { createTenantClient, tenantClientOptions } from "./client";
import { buildTenantClaims, mintTenantJwt } from "./jwt";
import { DbError } from "./transport";

afterEach(() => {
  setTransport(null);
  rpcMock.mockReset();
  vi.unstubAllEnvs();
});

describe("doprava přes supabase-js (service role)", () => {
  it("bytea posílá jako hexadecimální řetězec a vynechané argumenty neposílá", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await authPinSet({ weddingId: "w", role: "admin", hash: "$argon2id$x" }).catch(() => undefined);
    await authCreateSession({
      kind: "admin",
      weddingId: "w",
      subjectId: "s",
      tokenHash: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      idleSeconds: 10,
      absoluteSeconds: 20,
    });

    expect(rpcMock).toHaveBeenNthCalledWith(1, "auth_pin_set", {
      p_wedding_id: "w",
      p_role: "admin",
      p_hash: "$argon2id$x",
    });
    // klient service role vzniká jednou, s klíčem service role a bez vlastní relace Supabase Auth
    const [url, key, options] = createClientMock.mock.calls[0] as unknown as [
      string,
      string,
      { auth: Record<string, boolean> },
    ];
    expect(url).toBe("https://projekt.supabase.test");
    expect(key).toBe("service-role-key-service-role-key");
    expect(options.auth).toEqual({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "auth_create_session", {
      p_kind: "admin",
      p_wedding_id: "w",
      p_subject_id: "s",
      p_token_hash: "\\xdeadbeef",
      p_idle_seconds: 10,
      p_absolute_seconds: 20,
    });
  });

  it("chyba databáze nenese argumenty volání (mohou obsahovat osobní údaje)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    const error = await rateLimitHit("klic-s-hashem", 5, 60).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbError);
    expect((error as DbError).code).toBe("23505");
    expect((error as DbError).message).not.toContain("klic-s-hashem");
  });

  it("testovací doprava pg se v ostré produkci odmítne", () => {
    vi.stubEnv("DB_TRANSPORT", "pg");
    vi.stubEnv("VERCEL_ENV", "production");
    // env se čte při importu, proto nový import modulu
    vi.resetModules();
    return import("./transport").then((fresh) => {
      expect(() => fresh.getTransport()).toThrow(/produkci/);
    });
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

describe("JWT správce svatby", () => {
  const SECRET = "jwt-secret-jwt-secret-jwt-secret-jwt-1";
  const WEDDING = "11111111-1111-4111-8111-111111111111";
  const ADMIN = "22222222-2222-4222-8222-222222222222";
  const now = new Date("2026-10-02T12:00:00Z");

  it("nese claimy svatby a role admin a platí pět minut", () => {
    const claims = buildTenantClaims(
      { weddingId: WEDDING, weddingRole: "admin", subject: ADMIN },
      { now },
    );
    expect(claims).toMatchObject({
      sub: ADMIN,
      wedding_id: WEDDING,
      role: "authenticated",
      wedding_role: "admin",
    });
    expect(claims.exp - claims.iat).toBe(300);
  });

  it("odmítne správce bez subjektu, neplatné UUID a příliš dlouhou platnost", () => {
    expect(() => buildTenantClaims({ weddingId: WEDDING, weddingRole: "admin" })).toThrow();
    expect(() => buildTenantClaims({ weddingId: "není-uuid", weddingRole: "visitor" })).toThrow();
    expect(() =>
      buildTenantClaims({ weddingId: WEDDING, weddingRole: "visitor" }, { ttlSeconds: 3600 }),
    ).toThrow(/ttlSeconds/);
  });

  it("podpis je HS256 se sdíleným tajemstvím a krátké tajemství se odmítne", () => {
    const jwt = mintTenantJwt(
      { weddingId: WEDDING, weddingRole: "admin", subject: ADMIN },
      { secret: SECRET, now },
    );
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    expect(signature).toBe(
      createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url"),
    );
    expect(() =>
      mintTenantJwt({ weddingId: WEDDING, weddingRole: "visitor" }, { secret: "krátké" }),
    ).toThrow();
  });

  it("klient posílá JWT v hlavičce Authorization a nevede relaci Supabase Auth", () => {
    createClientMock.mockClear();
    createTenantClient({ weddingId: WEDDING, weddingRole: "admin", subject: ADMIN });
    const [, key, options] = createClientMock.mock.calls[0] as unknown as [
      string,
      string,
      ReturnType<typeof tenantClientOptions>,
    ];
    expect(key).toBe("service-role-key-service-role-key"); // jen apikey; oprávnění určuje JWT
    expect(options.global.headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(options.auth.persistSession).toBe(false);
    const payload = JSON.parse(
      Buffer.from(options.global.headers.Authorization.split(".")[1], "base64url").toString(),
    );
    expect(payload).toMatchObject({ wedding_id: WEDDING, wedding_role: "admin", sub: ADMIN });
  });
});
