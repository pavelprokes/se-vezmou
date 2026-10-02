import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  host: "app.se-vezmou.cz",
  cookies: new Map<string, string>(),
  set: [] as { name: string; value: string; [key: string]: unknown }[],
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => (name === "host" ? state.host : null) }),
  cookies: async () => ({
    get: (name: string) =>
      state.cookies.has(name) ? { value: state.cookies.get(name) } : undefined,
    set: (cookie: { name: string; value: string }) => state.set.push(cookie),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
// `cache` z Reactu v testu nic nesdílí mezi voláními
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));

import { setTransport } from "@/lib/db/rpc";
import { endSession, getSession, requireSession, startAdminSession } from "./session";

type Call = { fn: string; args: Record<string, unknown> };

function fakeDb(rows: Record<string, unknown>) {
  const calls: Call[] = [];
  setTransport({
    async call(fn, args) {
      calls.push({ fn, args });
      return rows[fn] ?? null;
    },
  });
  return calls;
}

const WEDDING = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const TOKEN = "A".repeat(43);

beforeEach(() => {
  state.host = "app.se-vezmou.cz";
  state.cookies = new Map();
  state.set = [];
});

afterEach(() => setTransport(null));

describe("startAdminSession", () => {
  it("vydá náhodný token, do databáze pošle jen hash a nastaví cookie s atributy __Host-", async () => {
    const calls = fakeDb({ auth_create_session: "session-id" });
    await startAdminSession(WEDDING, ADMIN);

    const [cookie] = state.set;
    expect(cookie).toMatchObject({
      name: "__Host-sv_admin",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 86400,
    });
    expect(cookie).not.toHaveProperty("domain");
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const create = calls.find((c) => c.fn === "auth_create_session")!;
    expect(create.args).toMatchObject({
      p_kind: "admin",
      p_wedding_id: WEDDING,
      p_subject_id: ADMIN,
      p_idle_seconds: 14 * 86400,
      p_absolute_seconds: 60 * 86400,
    });
    expect(
      (create.args.p_token_hash as Buffer).equals(
        createHash("sha256").update(cookie.value).digest(),
      ),
    ).toBe(true);
    expect(JSON.stringify(calls)).not.toContain(cookie.value);
  });

  it("starou relaci z cookie odvolá (bez fixace relace)", async () => {
    state.cookies.set("__Host-sv_admin", TOKEN);
    const calls = fakeDb({ auth_create_session: "id", auth_revoke_session: true });
    await startAdminSession(WEDDING, ADMIN);
    const revoke = calls.find((c) => c.fn === "auth_revoke_session")!;
    expect(
      (revoke.args.p_token_hash as Buffer).equals(createHash("sha256").update(TOKEN).digest()),
    ).toBe(true);
    expect(calls.map((c) => c.fn)).toEqual(["auth_revoke_session", "auth_create_session"]);
  });

  it("na localhostu je cookie bez prefixu a bez Secure", async () => {
    state.host = "app.localhost:3000";
    fakeDb({ auth_create_session: "id" });
    await startAdminSession(WEDDING, ADMIN);
    expect(state.set[0]).toMatchObject({
      name: "sv_admin",
      secure: false,
      httpOnly: true,
      sameSite: "lax",
    });
  });
});

describe("getSession", () => {
  const valid = [{ session_id: "s", wedding_id: WEDDING, kind: "admin", subject_id: ADMIN }];

  it("bez cookie je null a databáze se nedotazuje", async () => {
    const calls = fakeDb({});
    expect(await getSession()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("nesmyslná cookie je null bez dotazu na databázi", async () => {
    state.cookies.set("__Host-sv_admin", "kratke");
    const calls = fakeDb({});
    expect(await getSession()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("platná relace nese svatbu a správce", async () => {
    state.cookies.set("__Host-sv_admin", TOKEN);
    fakeDb({ auth_validate_session: valid });
    expect(await getSession()).toEqual({
      sessionId: "s",
      weddingId: WEDDING,
      kind: "admin",
      subjectId: ADMIN,
    });
  });

  it("neplatná relace (vypršela, odvolána) je null", async () => {
    state.cookies.set("__Host-sv_admin", TOKEN);
    fakeDb({ auth_validate_session: [] });
    expect(await getSession()).toBeNull();
  });

  it("relace hosta se jako relace správce nepřijme", async () => {
    state.cookies.set("__Host-sv_admin", TOKEN);
    fakeDb({
      auth_validate_session: [
        { session_id: "s", wedding_id: WEDDING, kind: "guest_pin", subject_id: null },
      ],
    });
    expect(await getSession()).toBeNull();
  });

  it("cookie s prefixem se na localhostu nečte a naopak (každé prostředí má svůj název)", async () => {
    state.host = "app.localhost:3000";
    state.cookies.set("__Host-sv_admin", TOKEN);
    const calls = fakeDb({ auth_validate_session: valid });
    expect(await getSession()).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("requireSession", () => {
  it("bez relace přesměruje na přihlášení", async () => {
    fakeDb({});
    await expect(requireSession()).rejects.toThrow("REDIRECT /prihlaseni");
  });
});

describe("endSession", () => {
  it("odvolá relaci v databázi a zruší cookie", async () => {
    state.cookies.set("__Host-sv_admin", TOKEN);
    const calls = fakeDb({ auth_revoke_session: true });
    await endSession();
    expect(calls.map((c) => c.fn)).toEqual(["auth_revoke_session"]);
    expect(state.set).toEqual([
      expect.objectContaining({
        name: "__Host-sv_admin",
        value: "",
        maxAge: 0,
        secure: true,
        httpOnly: true,
      }),
    ]);
  });

  it("bez cookie jen zruší cookie a databázi se nedotkne", async () => {
    const calls = fakeDb({});
    await endSession();
    expect(calls).toHaveLength(0);
    expect(state.set).toHaveLength(1);
  });
});
