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
  /** Pořadí událostí na spojení (dotazy a vrácení do poolu) a volitelné pozdržení `commit`. */
  events: [] as string[],
  commitGate: null as Promise<void> | null,
  failCommit: false,
}));
vi.mock("pg", () => ({
  Pool: class {
    on() {}
    async connect() {
      return {
        async query(sql: string, params: unknown[] = []) {
          queries.list.push({ sql, params });
          queries.events.push(sql.split(";")[0].slice(0, 24));
          if (sql === "commit") {
            if (queries.commitGate) await queries.commitGate;
            if (queries.failCommit) throw new Error("commit failed");
          }
          if (queries.failWith && /rsvp|select \*|select se_vezmou/.test(sql))
            throw queries.failWith;
          return { rows: [{ ticket: "t", v: { ok: true } }] };
        },
        release(broken?: boolean) {
          queries.events.push(broken ? "release:broken" : "release");
        },
      };
    }
  },
}));

const WEDDING = "11111111-1111-4111-8111-111111111111";
const SESSION = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  queries.list = [];
  queries.failWith = null;
  queries.events = [];
  queries.commitGate = null;
  queries.failCommit = false;
});
afterEach(() => vi.resetModules());

/** Claimy z úvodního dotazu transakce (jednoduchý protokol: `select set_config('request.jwt.claims', '<json>', true)`). */
function claimsOf(): Record<string, unknown> {
  const call = queries.list.find((q) => q.sql.includes("request.jwt.claims"));
  const match = /set_config\('request\.jwt\.claims', E?'(.*)', true\)/.exec(call?.sql ?? "");
  return JSON.parse((match?.[1] ?? "").replace(/''/g, "'"));
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
    // začátek transakce, role i claimy jsou jeden jednoduchý dotaz (jedna cesta sítí), pak volání a commit
    expect(sql).toHaveLength(3);
    expect(sql[0]).toMatch(
      /^begin; set local role authenticated; select set_config\('request\.jwt\.claims', '.*', true\)$/,
    );
    expect(sql[0]).toContain(", true)"); // jen pro tuto transakci
    expect(sql[1]).toBe("select * from se_vezmou.rsvp_match(p_name => $1)");
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
    expect(sql.join(" ")).not.toContain("authenticated");
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

  describe("čtení (readOnly): bez čekání na commit", () => {
    const visitor = { weddingId: WEDDING, weddingRole: "visitor" as const };

    it("transakce je read only, role a claimy zůstávají stejné jako u zápisu", async () => {
      const { getTransport } = await import("./transport");
      await getTransport().call("get_public_site", {}, "scalar", visitor, { readOnly: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const sql = queries.list.map((q) => q.sql);
      expect(sql[0]).toMatch(
        /^begin read only; set local role authenticated; select set_config\('request\.jwt\.claims', '.*', true\)$/,
      );
      expect(claimsOf()).toMatchObject({ wedding_id: WEDDING, wedding_role: "visitor" });
      expect(sql.at(-1)).toBe("commit");
      expect(sql.join(" ")).not.toContain("service_role");
    });

    it("výsledek se vrátí dřív než commit; spojení se vrátí do poolu až po něm", async () => {
      const { getTransport } = await import("./transport");
      let openGate!: () => void;
      queries.commitGate = new Promise<void>((resolve) => (openGate = resolve));
      const value = await getTransport().call("get_public_site", {}, "scalar", visitor, {
        readOnly: true,
      });
      expect(value).toEqual({ ok: true });
      // commit je rozeslaný, ale ještě nedoběhl; spojení nesmí být v poolu (nese otevřenou transakci)
      expect(queries.events.at(-1)).toBe("commit");
      expect(queries.events).not.toContain("release");
      openGate();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(queries.events.at(-1)).toBe("release");
    });

    it("selhání commitu u čtení spojení zahodí (release s chybou), volající výsledek už má", async () => {
      const { getTransport } = await import("./transport");
      queries.failCommit = true;
      const value = await getTransport().call("get_public_site", {}, "scalar", visitor, {
        readOnly: true,
      });
      expect(value).toEqual({ ok: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(queries.events.at(-1)).toBe("release:broken");
    });

    it("chyba čtení vrátí transakci zpět a spojení se vrátí hned", async () => {
      const { getTransport } = await import("./transport");
      queries.failWith = Object.assign(new Error("boom"), { code: "XX000" });
      await getTransport()
        .call("rsvp_get", {}, "scalar", visitor, { readOnly: true })
        .catch(() => undefined);
      const sql = queries.list.map((q) => q.sql);
      expect(sql.at(-1)).toBe("rollback");
      expect(sql).not.toContain("commit");
      expect(queries.events.at(-1)).toBe("release");
    });

    it("zápis (bez readOnly) čeká na commit před vrácením výsledku", async () => {
      const { getTransport } = await import("./transport");
      let openGate!: () => void;
      queries.commitGate = new Promise<void>((resolve) => (openGate = resolve));
      let done = false;
      const pending = getTransport()
        .call("rsvp_submit", {}, "scalar", visitor)
        .then(() => {
          done = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(done).toBe(false);
      openGate();
      await pending;
      expect(done).toBe(true);
    });
  });

  describe("escapeLiteral", () => {
    it("zdvojí uvozovky a zpětná lomítka a označí řetězec E, je-li třeba", async () => {
      const { escapeLiteral } = await import("./transport");
      expect(escapeLiteral("abc")).toBe("'abc'");
      expect(escapeLiteral("a'b")).toBe("'a''b'");
      expect(escapeLiteral("a\\b")).toBe(" E'a\\\\b'");
      expect(escapeLiteral("'; drop table x; --")).toBe("'''; drop table x; --'");
    });
  });
});
