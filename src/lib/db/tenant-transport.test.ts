import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Volání funkcí s totožností svatby (visitor, guest_pin, admin): každé volání je jedna transakce, v níž
 * se nastaví role `authenticated` a claimy té svatby, nikdy service role (docs/adr/0011).
 */

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test@localhost/test";
});

const queries = vi.hoisted(() => ({
  list: [] as { sql: string; params: unknown[] }[],
  failWith: null as unknown,
}));
vi.mock("pg", () => ({
  Pool: class {
    on() {}
    async connect() {
      return {
        async query(sql: string, params: unknown[] = []) {
          queries.list.push({ sql, params });
          if (queries.failWith && /rsvp|select \*|select se_vezmou/.test(sql))
            throw queries.failWith;
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
});
afterEach(() => vi.resetModules());

function claimsOf(): Record<string, unknown> {
  const call = queries.list.find((q) => q.sql.includes("request.jwt.claims"));
  return JSON.parse(String(call?.params[0]));
}

describe("přímý PostgreSQL: totožnost svatby jako claimy transakce", () => {
  it("návštěvník: claimy a role authenticated v téže transakci, před voláním funkce", async () => {
    const { getTransport } = await import("./transport");
    await getTransport().call("rsvp_match", { p_name: "Jan" }, "table", {
      weddingId: WEDDING,
      weddingRole: "visitor",
    });
    const sql = queries.list.map((q) => q.sql);
    // role i claimy jsou lokální pro transakci (set local, set_config(..., true)) a předcházejí volání
    expect(sql[0]).toBe("begin; set local role authenticated");
    expect(sql[1]).toContain("set_config('request.jwt.claims'");
    expect(sql[1]).toContain("true"); // jen pro tuto transakci
    expect(sql[2]).toBe("select * from se_vezmou.rsvp_match(p_name => $1)");
    expect(sql.at(-1)).toBe("commit");
    expect(claimsOf()).toMatchObject({
      wedding_id: WEDDING,
      wedding_role: "visitor",
      sub: "00000000-0000-0000-0000-000000000000",
    });
    expect(sql.join(" ")).not.toContain("service_role");
  });

  it("chyba funkce vrátí transakci zpět (rollback), ne commit", async () => {
    const { getTransport } = await import("./transport");
    queries.failWith = Object.assign(new Error("boom"), { code: "XX000" });
    await getTransport()
      .call("rsvp_get", {}, "scalar", { weddingId: WEDDING, weddingRole: "visitor" })
      .catch(() => undefined);
    const sql = queries.list.map((q) => q.sql);
    expect(sql.at(-1)).toBe("rollback");
    expect(sql).not.toContain("commit");
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
    expect(sql[0]).toBe("begin; set local role service_role");
    expect(sql.at(-1)).toBe("commit");
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
    expect(queries.list).toEqual([]); // spojení se ani nevzalo
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
