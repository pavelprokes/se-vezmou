import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Volání funkcí s totožností svatby (visitor, guest_pin, admin): obě dopravy (PostgREST s JWT
 * a přímý PostgreSQL v testech) nastaví stejné claimy a roli `authenticated`, nikdy service role.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projekt.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-service-role-key";
  process.env.SUPABASE_JWT_SECRET = "jwt-secret-jwt-secret-jwt-secret-jwt-1";
  process.env.DB_TRANSPORT = "pg";
  process.env.DATABASE_URL = "postgresql://test@localhost/test";
});

const rpcMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn(() => ({ rpc: rpcMock })));
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

const queries = vi.hoisted(() => ({
  list: [] as { sql: string; params: unknown[] }[],
  failWith: null as unknown,
}));
vi.mock("pg", () => ({
  Pool: class {
    async connect() {
      return {
        async query(sql: string, params: unknown[] = []) {
          queries.list.push({ sql, params });
          if (queries.failWith && /rsvp|select \*|select public/.test(sql)) throw queries.failWith;
          return { rows: [{ ticket: "t", v: { ok: true } }] };
        },
        release() {},
      };
    }
  },
}));

const WEDDING = "11111111-1111-4111-8111-111111111111";
const SESSION = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  queries.list = [];
  queries.failWith = null;
  rpcMock.mockReset();
  createClientMock.mockClear();
});
afterEach(() => vi.resetModules());

function claimsOf(): Record<string, unknown> {
  const call = queries.list.find((q) => q.sql.includes("request.jwt.claims"));
  return JSON.parse(String(call?.params[0]));
}

describe("přímý PostgreSQL (e2e): totožnost svatby jako claimy JWT", () => {
  it("návštěvník: claimy a role authenticated v téže transakci, před voláním funkce", async () => {
    const { getTransport } = await import("./transport");
    await getTransport().call("rsvp_match", { p_name: "Jan" }, "table", {
      weddingId: WEDDING,
      weddingRole: "visitor",
    });
    const sql = queries.list.map((q) => q.sql);
    expect(sql[0]).toBe("begin");
    expect(sql[1]).toContain("set_config('request.jwt.claims'");
    expect(sql[1]).toContain("true"); // jen pro tuto transakci
    expect(sql[2]).toBe("set local role authenticated");
    expect(sql[3]).toBe("select * from public.rsvp_match(p_name => $1)");
    expect(sql.at(-1)).toBe("commit");
    expect(claimsOf()).toMatchObject({
      wedding_id: WEDDING,
      wedding_role: "visitor",
      role: "authenticated",
      sub: "00000000-0000-0000-0000-000000000000",
    });
    expect(sql.join(" ")).not.toContain("service_role");
  });

  it("host po PINu má subjektem id relace, správce id správce", async () => {
    const { getTransport } = await import("./transport");
    await getTransport().call("get_public_site", {}, "scalar", {
      weddingId: WEDDING,
      weddingRole: "guest_pin",
      subject: SESSION,
    });
    expect(claimsOf()).toMatchObject({ wedding_role: "guest_pin", sub: SESSION });
    queries.list = [];
    await getTransport().call("admin_guest_list", {}, "scalar", {
      weddingId: WEDDING,
      weddingRole: "admin",
      subject: SESSION,
    });
    expect(claimsOf()).toMatchObject({ wedding_role: "admin" });
  });

  it("bez totožnosti se funkce volá jako service role (před ověřením)", async () => {
    const { getTransport } = await import("./transport");
    await getTransport().call("rate_limit_hit", { p_bucket_key: "k" }, "table");
    const sql = queries.list.map((q) => q.sql);
    expect(sql).toContain("set local role service_role");
    expect(sql.join(" ")).not.toContain("request.jwt.claims");
  });

  it("neplatná totožnost (chybějící subjekt správce) se nikdy nepošle do databáze", async () => {
    const { getTransport } = await import("./transport");
    await expect(
      getTransport().call("admin_guest_list", {}, "scalar", {
        weddingId: WEDDING,
        weddingRole: "admin",
      }),
    ).rejects.toThrow();
    expect(queries.list.map((q) => q.sql)).not.toContain("set local role authenticated");
  });

  it("chyba funkce nese jen identifikátor hlášení (rsvp_closed), ne systémový text s hodnotami", async () => {
    const { getTransport, DbError } = await import("./transport");
    queries.failWith = Object.assign(new Error("rsvp_closed"), { code: "55000" });
    const closed = await getTransport()
      .call("rsvp_submit", { p_ticket: "tajný lístek" }, "scalar", {
        weddingId: WEDDING,
        weddingRole: "visitor",
      })
      .catch((e: unknown) => e);
    expect(closed).toBeInstanceOf(DbError);
    expect(closed).toMatchObject({ code: "55000", reason: "rsvp_closed" });
    expect((closed as Error).message).not.toContain("tajný lístek");

    queries.failWith = Object.assign(new Error('invalid input syntax for type uuid: "Jan Novák"'), {
      code: "22P02",
    });
    const raw = await getTransport()
      .call("rsvp_submit", {}, "scalar", { weddingId: WEDDING, weddingRole: "visitor" })
      .catch((e: unknown) => e);
    expect((raw as InstanceType<typeof DbError>).reason).toBeUndefined();
    expect((raw as Error).message).not.toContain("Jan Novák");
  });
});

describe("supabase-js: totožnost svatby jako krátkodobé JWT", () => {
  it("klient svatby se vytvoří s JWT v hlavičce, service role se pro funkci nepoužije", async () => {
    vi.stubEnv("DB_TRANSPORT", "supabase");
    vi.resetModules();
    const { getTransport } = await import("./transport");
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    await getTransport().call("rsvp_get", { p_ticket: "t" }, "scalar", {
      weddingId: WEDDING,
      weddingRole: "visitor",
    });
    expect(createClientMock).toHaveBeenCalledTimes(1);
    const [, , options] = createClientMock.mock.calls[0] as unknown as [
      string,
      string,
      { global: { headers: { Authorization: string } } },
    ];
    const payload = JSON.parse(
      Buffer.from(options.global.headers.Authorization.split(".")[1], "base64url").toString(),
    );
    expect(payload).toMatchObject({
      wedding_id: WEDDING,
      wedding_role: "visitor",
      role: "authenticated",
    });
    expect(rpcMock).toHaveBeenCalledWith("rsvp_get", { p_ticket: "t" });
    vi.unstubAllEnvs();
  });

  it("chyba funkce nese identifikátor hlášení z PostgREST", async () => {
    vi.stubEnv("DB_TRANSPORT", "supabase");
    vi.resetModules();
    const { getTransport, DbError } = await import("./transport");
    rpcMock.mockResolvedValue({ data: null, error: { code: "28000", message: "invalid_ticket" } });
    const error = await getTransport()
      .call("rsvp_submit", { p_ticket: "x" }, "scalar", {
        weddingId: WEDDING,
        weddingRole: "visitor",
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject({ code: "28000", reason: "invalid_ticket" });
    vi.unstubAllEnvs();
  });
});
