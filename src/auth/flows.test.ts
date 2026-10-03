import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET = "auth-secret-auth-secret-auth-secret-1";
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
  process.env.PIN_PEPPER = "pepper-pepper-pepper-pepper-pepper-0001";
});

vi.mock("@/lib/email/transport", () => ({
  sendEmail: vi.fn(async () => ({ providerMessageId: "msg-1" })),
}));

import { sendEmail } from "@/lib/email/transport";
import { setTransport } from "@/lib/db/rpc";
import type { RpcTransport } from "@/lib/db/transport";
import { seal } from "./crypto";
import { codeHash, emailHash } from "./identity";
import {
  openLoginLink,
  openPendingLogin,
  requestLoginCode,
  sealPendingLogin,
  verifyLoginCode,
} from "./login";
import { hashPin } from "./pin";
import { loginWithPin, setPin } from "./pin-login";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const PEPPER = process.env.PIN_PEPPER!;
const WEDDING = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";

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
  return { calls, names: () => calls.map((c) => c.fn) };
}

const allow: Handler = () => [{ allowed: true, retry_after: 0 }];
const logHandlers = {
  email_log_insert: () => "44444444-4444-4444-8444-444444444444",
  email_log_set_status: () => true,
};

function deferred() {
  const tasks: (() => Promise<unknown>)[] = [];
  return {
    defer: (task: () => Promise<unknown>) => void tasks.push(task),
    tasks,
    runAll: () => Promise.all(tasks.map((task) => task())),
  };
}

const sendMock = vi.mocked(sendEmail);

beforeEach(() => {
  sendMock.mockClear();
});

afterEach(() => {
  setTransport(null);
  vi.useRealTimers();
});

const base = {
  email: "klara@example.cz",
  ip: "203.0.113.7",
  locale: "cs" as const,
  origin: "https://app.se-vezmou.cz",
};

const weddingRows = [
  { admin_id: ADMIN, wedding_id: WEDDING, slug: "klara-a-matej", status: "draft" },
];

describe("requestLoginCode", () => {
  it("známý e-mail: uloží výzvu jen jako hash, pošle e-mail až po odpovědi", async () => {
    const db = fakeDb({
      rate_limit_hit: allow,
      auth_list_admin_weddings: () => weddingRows,
      auth_create_challenge: () => "challenge-id",
      ...logHandlers,
    });
    const d = deferred();

    expect(await requestLoginCode({ ...base, defer: d.defer })).toEqual({ status: "sent" });
    expect(sendMock).not.toHaveBeenCalled(); // e-mail se odešle až v defer (po odpovědi)
    expect(d.tasks).toHaveLength(1);

    const challenge = db.calls.find((c) => c.fn === "auth_create_challenge")!;
    expect(challenge.args.p_purpose).toBe("admin_login");
    expect(challenge.args.p_ttl_seconds).toBe(600);
    expect((challenge.args.p_email_hash as Buffer).length).toBe(32);
    expect((challenge.args.p_code_hash as Buffer).length).toBe(32);

    // v databázi není čitelný e-mail ani IP (jen výjimka: hledání správců podle e-mailu)
    const rest = JSON.stringify(db.calls.filter((c) => c.fn !== "auth_list_admin_weddings"));
    expect(rest).not.toContain("klara");
    expect(rest).not.toContain("203.0.113.7");

    await d.runAll();
    expect(sendMock).toHaveBeenCalledTimes(1);
    const message = sendMock.mock.calls[0][0];
    expect(message.to).toBe("klara@example.cz");
    const code = /^(\d{6})$/m.exec(message.text)![1];

    // kód v e-mailu odpovídá hashi uloženému v databázi
    expect(
      codeHash(AUTH_SECRET, "klara@example.cz", code).equals(challenge.args.p_code_hash as Buffer),
    ).toBe(true);
    expect(
      emailHash(AUTH_SECRET, "klara@example.cz").equals(challenge.args.p_email_hash as Buffer),
    ).toBe(true);

    // odkaz v e-mailu otevře potvrzovací stránku se stejným kódem a e-mailem
    const link = /(https:\/\/app\.se-vezmou\.cz\/prihlaseni\/odkaz\?t=\S+)/.exec(message.text)![1];
    expect(openLoginLink(new URL(link).searchParams.get("t")!)).toEqual({
      email: "klara@example.cz",
      code,
    });
    expect(link).not.toContain("klara@");
    expect(link).not.toContain(code);
  });

  it("záznam e-mailu nese jen typ, jazyk, svatbu, hash a doménu (bez PII)", async () => {
    const db = fakeDb({
      rate_limit_hit: allow,
      auth_list_admin_weddings: () => weddingRows,
      auth_create_challenge: () => "challenge-id",
      ...logHandlers,
    });
    const d = deferred();
    await requestLoginCode({ ...base, defer: d.defer });
    await d.runAll();

    const insert = db.calls.find((c) => c.fn === "email_log_insert")!;
    expect(Object.keys(insert.args).sort()).toEqual([
      "p_locale",
      "p_recipient_domain",
      "p_recipient_hash",
      "p_type",
      "p_wedding_id",
    ]);
    expect(insert.args).toMatchObject({
      p_type: "login_code",
      p_locale: "cs",
      p_recipient_domain: "example.cz",
      p_wedding_id: null,
    });
    expect(JSON.stringify(insert.args)).not.toContain("klara");
    const status = db.calls.find((c) => c.fn === "email_log_set_status")!;
    expect(status.args).toMatchObject({ p_status: "sent", p_provider_message_id: "msg-1" });
  });

  it("neznámý e-mail: stejná odpověď a stejná práce v databázi, ale e-mail se neposílá", async () => {
    const known = fakeDb({
      rate_limit_hit: allow,
      auth_list_admin_weddings: () => weddingRows,
      auth_create_challenge: () => "id",
      ...logHandlers,
    });
    const dKnown = deferred();
    const knownResult = await requestLoginCode({ ...base, defer: dKnown.defer });
    const knownNames = known.names();

    const unknown = fakeDb({
      rate_limit_hit: allow,
      auth_list_admin_weddings: () => [],
      auth_create_challenge: () => "id",
      ...logHandlers,
    });
    const dUnknown = deferred();
    const unknownResult = await requestLoginCode({
      ...base,
      email: "nikdo@example.cz",
      defer: dUnknown.defer,
    });

    expect(unknownResult).toEqual(knownResult);
    expect(unknown.names()).toEqual(knownNames);
    expect(dUnknown.tasks).toHaveLength(0);
    expect(dKnown.tasks).toHaveLength(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("překročený limit e-mailu: stejná odpověď, kód se neposílá a výzva se nezakládá", async () => {
    const db = fakeDb({
      rate_limit_hit: (args) => [
        {
          allowed: !String(args.p_bucket_key).startsWith("login-request-email:"),
          retry_after: 100,
        },
      ],
      auth_list_admin_weddings: () => weddingRows,
      auth_create_challenge: () => "id",
    });
    const d = deferred();
    expect(await requestLoginCode({ ...base, defer: d.defer })).toEqual({ status: "sent" });
    expect(db.names()).not.toContain("auth_create_challenge");
    expect(d.tasks).toHaveLength(0);
  });

  it("překročený limit IP: obecná odpověď s dobou čekání a nic dalšího se nedělá", async () => {
    const db = fakeDb({ rate_limit_hit: () => [{ allowed: false, retry_after: 120 }] });
    const d = deferred();
    expect(await requestLoginCode({ ...base, defer: d.defer })).toEqual({
      status: "limited",
      retryAfter: 120,
    });
    expect(db.names()).toEqual(["rate_limit_hit"]);
  });

  it("limity: 5 za hodinu na e-mail a 20 za hodinu na IP, klíče jsou HMAC", async () => {
    const db = fakeDb({
      rate_limit_hit: allow,
      auth_list_admin_weddings: () => [],
      auth_create_challenge: () => "id",
    });
    await requestLoginCode({ ...base, defer: deferred().defer });
    const hits = db.calls.filter((c) => c.fn === "rate_limit_hit").map((c) => c.args);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ p_limit: 20, p_window: "3600 seconds" });
    expect(String(hits[0].p_bucket_key)).toMatch(/^login-request-ip:[A-Za-z0-9_-]{43}$/);
    expect(hits[1]).toMatchObject({ p_limit: 5, p_window: "3600 seconds" });
    expect(String(hits[1].p_bucket_key)).toMatch(/^login-request-email:[A-Za-z0-9_-]{43}$/);
  });

  it("selhání úložiště omezení shodí přihlášení (selže zavřeně)", async () => {
    fakeDb({
      rate_limit_hit: () => {
        throw new Error("databáze nedostupná");
      },
    });
    await expect(requestLoginCode({ ...base, defer: deferred().defer })).rejects.toThrow();
  });
});

describe("verifyLoginCode", () => {
  const input = { email: "klara@example.cz", code: "048213", ip: "203.0.113.7" };

  it("platný kód: vrátí svatbu a správce, výzvu ověřuje podle hashe a s pěti pokusy", async () => {
    const db = fakeDb({
      rate_limit_hit: allow,
      auth_verify_challenge: () => true,
      auth_list_admin_weddings: () => weddingRows,
    });
    expect(await verifyLoginCode(input)).toEqual({
      status: "ok",
      weddingId: WEDDING,
      adminId: ADMIN,
    });
    const verify = db.calls.find((c) => c.fn === "auth_verify_challenge")!;
    expect(verify.args).toMatchObject({ p_purpose: "admin_login", p_max_attempts: 5 });
    expect(
      codeHash(AUTH_SECRET, input.email, input.code).equals(verify.args.p_code_hash as Buffer),
    ).toBe(true);
    expect(db.calls.find((c) => c.fn === "rate_limit_hit")!.args).toMatchObject({ p_limit: 30 });
  });

  it("chybný nebo použitý kód: invalid a nehledají se svatby", async () => {
    const db = fakeDb({ rate_limit_hit: allow, auth_verify_challenge: () => false });
    expect(await verifyLoginCode(input)).toEqual({ status: "invalid" });
    expect(db.names()).not.toContain("auth_list_admin_weddings");
  });

  it("ověřený kód bez svatby (odebraný správce) je také invalid", async () => {
    fakeDb({
      rate_limit_hit: allow,
      auth_verify_challenge: () => true,
      auth_list_admin_weddings: () => [],
    });
    expect(await verifyLoginCode(input)).toEqual({ status: "invalid" });
  });

  it("limit IP: kód se vůbec neověřuje", async () => {
    const db = fakeDb({ rate_limit_hit: () => [{ allowed: false, retry_after: 60 }] });
    expect(await verifyLoginCode(input)).toEqual({ status: "limited", retryAfter: 60 });
    expect(db.names()).toEqual(["rate_limit_hit"]);
  });

  it("zablokovaný web se nenabídne: otevře se nejstarší nezablokovaný, jinak invalid", async () => {
    const blocked = {
      ...weddingRows[0],
      wedding_id: "55555555-5555-4555-8555-555555555555",
      status: "blocked",
    };
    fakeDb({
      rate_limit_hit: allow,
      auth_verify_challenge: () => true,
      auth_list_admin_weddings: () => [blocked, ...weddingRows],
    });
    expect(await verifyLoginCode(input)).toMatchObject({ status: "ok", weddingId: WEDDING });
    fakeDb({
      rate_limit_hit: allow,
      auth_verify_challenge: () => true,
      auth_list_admin_weddings: () => [blocked],
    });
    expect(await verifyLoginCode(input)).toEqual({ status: "invalid" });
  });
});

describe("requestLoginCode: zablokovaný web", () => {
  it("kód se kvůli zablokovanému webu neposílá (jako u neznámého e-mailu)", async () => {
    const d = deferred();
    fakeDb({
      rate_limit_hit: allow,
      auth_create_challenge: () => "99999999-9999-4999-8999-999999999999",
      auth_list_admin_weddings: () => [{ ...weddingRows[0], status: "blocked" }],
      ...logHandlers,
    });
    expect(await requestLoginCode({ ...base, defer: d.defer })).toEqual({ status: "sent" });
    expect(d.tasks).toHaveLength(0);
  });
});

describe("odkaz a rozpracované přihlášení", () => {
  it("odkaz po uplynutí platnosti, upravený nebo cizí neotevře", () => {
    const expired = seal(AUTH_SECRET, "login-link", {
      e: "a@b.cz",
      c: "123456",
      x: Date.now() - 1,
    });
    expect(openLoginLink(expired)).toBeNull();
    const valid = seal(AUTH_SECRET, "login-link", {
      e: "a@b.cz",
      c: "123456",
      x: Date.now() + 60_000,
    });
    expect(openLoginLink(valid)).toEqual({ email: "a@b.cz", code: "123456" });
    expect(openLoginLink(valid.slice(0, -3) + "xyz")).toBeNull();
    expect(openLoginLink("nesmysl")).toBeNull();
    // zapečetěné rozpracované přihlášení nejde použít jako odkaz
    expect(openLoginLink(sealPendingLogin("a@b.cz"))).toBeNull();
  });

  it("rozpracované přihlášení platí 10 minut", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    const token = sealPendingLogin("klara@example.cz");
    expect(openPendingLogin(token)).toBe("klara@example.cz");
    vi.setSystemTime(new Date("2026-10-02T12:09:59Z"));
    expect(openPendingLogin(token)).toBe("klara@example.cz");
    vi.setSystemTime(new Date("2026-10-02T12:10:01Z"));
    expect(openPendingLogin(token)).toBeNull();
  });
});

describe("loginWithPin", () => {
  const pinInput = {
    slug: "klara-a-matej" as string | null,
    pin: "482915",
    ip: "203.0.113.7",
    locale: "cs" as const,
    origin: "https://app.se-vezmou.cz",
  };
  let pinHash: string;

  beforeEach(async () => {
    pinHash ??= await hashPin("482915", PEPPER);
  });

  const record = () => [
    { wedding_id: WEDDING, admin_id: ADMIN, pin_hash: pinHash, backup_email: "zaloha@example.cz" },
  ];
  const notLocked = () => [{ locked: false, retry_after: 0 }];

  it("správný PIN: přihlásí, vynuluje sérii a oznámí přihlášení na záložní e-mail", async () => {
    const db = fakeDb({
      rate_limit_hit: allow,
      auth_lockout_state: notLocked,
      auth_pin_get: record,
      auth_lockout_reset: () => null,
      ...logHandlers,
    });
    const d = deferred();
    expect(await loginWithPin({ ...pinInput, defer: d.defer })).toEqual({
      status: "ok",
      weddingId: WEDDING,
      adminId: ADMIN,
    });
    expect(db.names()).toContain("auth_lockout_reset");
    expect(db.calls.find((c) => c.fn === "auth_pin_get")!.args).toEqual({
      p_slug: "klara-a-matej",
      p_role: "admin",
    });

    expect(d.tasks).toHaveLength(1);
    await d.runAll();
    const message = sendMock.mock.calls[0][0];
    expect(message.to).toBe("zaloha@example.cz");
    expect(message.text).toContain("klara-a-matej.se-vezmou.cz");
    expect(message.subject).toMatch(/PIN/);
    expect(db.calls.find((c) => c.fn === "email_log_insert")!.args.p_type).toBe(
      "backup_login_notice",
    );
  });

  it("nepotvrzená záložní adresa (databáze vrací null): přihlášení ani pauza nic neposílají", async () => {
    const unconfirmed = () => [
      { wedding_id: WEDDING, admin_id: ADMIN, pin_hash: pinHash, backup_email: null },
    ];
    const db = fakeDb({
      rate_limit_hit: allow,
      auth_lockout_state: notLocked,
      auth_pin_get: unconfirmed,
      auth_lockout_reset: () => null,
      auth_lockout_failure: () => [
        { locked: true, retry_after: 900, level: 1, newly_locked: true },
      ],
      ...logHandlers,
    });
    const ok = deferred();
    expect(await loginWithPin({ ...pinInput, defer: ok.defer })).toMatchObject({ status: "ok" });
    const locked = deferred();
    expect(await loginWithPin({ ...pinInput, pin: "482916", defer: locked.defer })).toEqual({
      status: "locked",
      retryAfter: 900,
    });
    expect(ok.tasks).toHaveLength(0);
    expect(locked.tasks).toHaveLength(0);
    expect(sendMock).not.toHaveBeenCalled();
    expect(db.names()).not.toContain("email_log_insert");
  });

  it("klíč pauzy i limitu je HMAC, ne slug ani IP", async () => {
    const db = fakeDb({
      rate_limit_hit: allow,
      auth_lockout_state: notLocked,
      auth_pin_get: record,
      auth_lockout_reset: () => null,
      ...logHandlers,
    });
    await loginWithPin({ ...pinInput, defer: deferred().defer });
    const keys = db.calls
      .filter((c) => c.args.p_bucket_key)
      .map((c) => String(c.args.p_bucket_key));
    expect(keys).toHaveLength(3);
    for (const key of keys) {
      expect(key).not.toContain("klara");
      expect(key).not.toContain("203.0.113.7");
    }
    expect(keys[0]).toMatch(/^pin-admin-ip:/);
    expect(keys[1]).toMatch(/^pin-admin-wedding:/);
    expect(keys[2]).toBe(keys[1]);
  });

  it("chybný PIN: invalid, chyba se započítá (5 / 15 min / 24 h) a nic se neposílá", async () => {
    const db = fakeDb({
      rate_limit_hit: allow,
      auth_lockout_state: notLocked,
      auth_pin_get: record,
      auth_lockout_failure: () => [
        { locked: false, retry_after: 0, level: 0, newly_locked: false },
      ],
    });
    const d = deferred();
    expect(await loginWithPin({ ...pinInput, pin: "482916", defer: d.defer })).toEqual({
      status: "invalid",
    });
    expect(db.calls.find((c) => c.fn === "auth_lockout_failure")!.args).toMatchObject({
      p_threshold: 5,
      p_base_seconds: 900,
      p_max_seconds: 86400,
    });
    expect(db.names()).not.toContain("auth_lockout_reset");
    expect(d.tasks).toHaveLength(0);
  });

  it("pátá chyba: pauza a oznámení o ní na záložní e-mail", async () => {
    const db = fakeDb({
      rate_limit_hit: allow,
      auth_lockout_state: notLocked,
      auth_pin_get: record,
      auth_lockout_failure: () => [
        { locked: true, retry_after: 900, level: 1, newly_locked: true },
      ],
      ...logHandlers,
    });
    const d = deferred();
    expect(await loginWithPin({ ...pinInput, pin: "482916", defer: d.defer })).toEqual({
      status: "locked",
      retryAfter: 900,
    });
    expect(d.tasks).toHaveLength(1);
    await d.runAll();
    const message = sendMock.mock.calls[0][0];
    expect(message.to).toBe("zaloha@example.cz");
    expect(message.text).toMatch(/15\u00a0minut/);
    expect(db.calls.find((c) => c.fn === "email_log_insert")).toBeDefined();
  });

  it("probíhající pauza: PIN se ani neověřuje", async () => {
    const db = fakeDb({
      rate_limit_hit: allow,
      auth_lockout_state: () => [{ locked: true, retry_after: 600 }],
    });
    expect(await loginWithPin({ ...pinInput, defer: deferred().defer })).toEqual({
      status: "locked",
      retryAfter: 600,
    });
    expect(db.names()).not.toContain("auth_pin_get");
  });

  it("neznámá svatba: stejná odpověď jako chybný PIN, chyba se počítá, e-mail se neposílá", async () => {
    const db = fakeDb({
      rate_limit_hit: allow,
      auth_lockout_state: notLocked,
      auth_pin_get: () => [],
      auth_lockout_failure: () => [
        { locked: false, retry_after: 0, level: 0, newly_locked: false },
      ],
    });
    const d = deferred();
    expect(await loginWithPin({ ...pinInput, slug: "neexistuje", defer: d.defer })).toEqual({
      status: "invalid",
    });
    expect(db.names()).toContain("auth_lockout_failure");
    expect(d.tasks).toHaveLength(0);
  });

  it("neznámá svatba po sérii chyb hlásí pauzu stejně jako existující (bez prozrazení)", async () => {
    fakeDb({
      rate_limit_hit: allow,
      auth_lockout_state: notLocked,
      auth_pin_get: () => [],
      auth_lockout_failure: () => [
        { locked: true, retry_after: 900, level: 1, newly_locked: true },
      ],
    });
    const d = deferred();
    expect(await loginWithPin({ ...pinInput, slug: "neexistuje", defer: d.defer })).toEqual({
      status: "locked",
      retryAfter: 900,
    });
    expect(d.tasks).toHaveLength(0);
  });

  it("neplatný tvar adresy: invalid bez dotazu na svatbu a bez pauzy", async () => {
    const db = fakeDb({ rate_limit_hit: allow });
    expect(await loginWithPin({ ...pinInput, slug: null, defer: deferred().defer })).toEqual({
      status: "invalid",
    });
    expect(db.names()).toEqual(["rate_limit_hit"]);
  });

  it("limit IP: odmítne bez ověřování", async () => {
    const db = fakeDb({ rate_limit_hit: () => [{ allowed: false, retry_after: 300 }] });
    expect(await loginWithPin({ ...pinInput, defer: deferred().defer })).toEqual({
      status: "limited",
      retryAfter: 300,
    });
    expect(db.names()).toEqual(["rate_limit_hit"]);
  });
});

describe("setPin", () => {
  const input = {
    weddingId: WEDDING,
    slug: "klara-a-matej" as string | null,
    role: "admin" as const,
    actorAdminId: ADMIN,
    keepSessionId: SESSION,
    locale: "cs" as const,
    origin: "https://app.se-vezmou.cz",
  };

  it("triviální a příliš krátký PIN odmítne dřív, než sáhne do databáze", async () => {
    const db = fakeDb({});
    expect(await setPin({ ...input, pin: "123456", defer: deferred().defer })).toEqual({
      status: "invalid",
      problem: "trivial",
    });
    expect(await setPin({ ...input, pin: "48291", defer: deferred().defer })).toEqual({
      status: "invalid",
      problem: "format",
    });
    expect(db.calls).toHaveLength(0);
  });

  it("PIN shodný s druhým PINem téže svatby odmítne (společný PIN je zakázán)", async () => {
    const otherHash = await hashPin("482915", PEPPER);
    const db = fakeDb({ auth_pin_other_hash: () => otherHash });
    expect(await setPin({ ...input, pin: "482915", defer: deferred().defer })).toEqual({
      status: "invalid",
      problem: "same_as_other",
    });
    expect(db.names()).toEqual(["auth_pin_other_hash"]);
    expect(db.calls[0].args).toEqual({ p_wedding_id: WEDDING, p_role: "admin" });
  });

  it("jiný PIN uloží jako argon2id, odvolá ostatní relace a oznámí změnu na záložní e-mail", async () => {
    const otherHash = await hashPin("739104", PEPPER);
    const db = fakeDb({
      auth_pin_other_hash: () => otherHash,
      auth_pin_set: () => "zaloha@example.cz",
      ...logHandlers,
    });
    const d = deferred();
    expect(await setPin({ ...input, pin: "482915", defer: d.defer })).toEqual({
      status: "ok",
      backupEmail: "zaloha@example.cz",
    });
    const set = db.calls.find((c) => c.fn === "auth_pin_set")!;
    expect(String(set.args.p_hash).startsWith("$argon2id$")).toBe(true);
    expect(JSON.stringify(set.args)).not.toContain("482915");
    expect(set.args).toMatchObject({
      p_role: "admin",
      p_actor_admin_id: ADMIN,
      p_keep_session_id: SESSION,
    });

    await d.runAll();
    const message = sendMock.mock.calls[0][0];
    expect(message.to).toBe("zaloha@example.cz");
    expect(message.subject).toMatch(/Změna PINu/);
  });

  it("nepotvrzená záložní adresa (auth_pin_set vrací null): změna PINu nic neposílá", async () => {
    const db = fakeDb({
      auth_pin_other_hash: () => null,
      auth_pin_set: () => null,
      ...logHandlers,
    });
    const d = deferred();
    expect(await setPin({ ...input, pin: "482915", defer: d.defer })).toEqual({
      status: "ok",
      backupEmail: null,
    });
    expect(d.tasks).toHaveLength(0);
    expect(db.names()).not.toContain("email_log_insert");
  });

  it("PIN hostů se porovnává s hashem PINu správy", async () => {
    const adminHash = await hashPin("482915", PEPPER);
    const db = fakeDb({ auth_pin_other_hash: () => adminHash });
    await setPin({ ...input, role: "guest", pin: "482915", defer: deferred().defer });
    expect(db.calls[0].args).toEqual({ p_wedding_id: WEDDING, p_role: "guest" });
  });
});
