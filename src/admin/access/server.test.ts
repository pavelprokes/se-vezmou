import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
  process.env.AUTH_SECRET = "auth-secret-auth-secret-auth-secret-1";
  process.env.NEXT_PUBLIC_SITE_URL = "https://se-vezmou.cz";
});

const mail = vi.hoisted(() => ({ send: vi.fn(async () => true) }));
vi.mock("@/lib/email/send", () => ({ sendTemplatedEmail: mail.send }));
const pin = vi.hoisted(() => ({ setPin: vi.fn() }));
vi.mock("@/auth/pin-login", () => ({ setPin: pin.setPin }));

import { setTransport } from "@/lib/db/rpc";
import { DbError } from "@/lib/db/transport";
import {
  addAdmin,
  changePin,
  deleteSite,
  grantAccess,
  loadAccess,
  notifyGuestDataViewed,
  removeAdmin,
  revokeAccess,
  setBackupEmail,
  setGuestPinEnabled,
  setSiteLocked,
  type AccessContext,
} from "./server";

const WEDDING = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ACTOR = {
  weddingId: WEDDING,
  subjectId: ADMIN,
  sessionId: "44444444-4444-4444-8444-444444444444",
};

type Call = { fn: string; args: Record<string, unknown> };

const VIEW = {
  max_admins: 3,
  admins: [
    {
      id: ADMIN,
      email: "eva@example.test",
      added_at: "2026-10-01T10:00:00Z",
      last_login_at: null,
      is_me: true,
    },
  ],
  backup_email: "zaloha@example.test",
  has_admin_pin: true,
  has_guest_pin: true,
  guest_pin_enabled: true,
  status: "published",
  slug: "klara-a-matej",
  restore_days: 30,
  default_locale: "cs",
  timezone: "Europe/Prague",
  grants: [],
  operator_views: [],
};

function fakeDb(
  results: Record<string, unknown> = {},
  options: { rateAllowed?: boolean; fail?: Record<string, DbError>; siteLocked?: boolean } = {},
) {
  const calls: Call[] = [];
  setTransport({
    async call(fn, args) {
      calls.push({ fn, args });
      if (options.fail?.[fn]) throw options.fail[fn];
      if (fn === "rate_limit_hit") {
        const allowed = options.rateAllowed ?? true;
        return [{ allowed, retry_after: allowed ? 0 : 55 }];
      }
      if (fn === "admin_access_load") return VIEW;
      if (fn === "admin_site_lock_get") return options.siteLocked ?? false;
      if (fn === "auth_session_context") {
        return [
          { slug: "klara-a-matej", status: "published", partner_a_name: "K", partner_b_name: "M" },
        ];
      }
      if (fn in results) return results[fn];
      throw new Error(`Neočekávané volání ${fn}`);
    },
  });
  return calls;
}

let deferred: Promise<unknown>[] = [];
const ctx: AccessContext = {
  locale: "cs",
  loginUrl: "https://app.se-vezmou.cz/prihlaseni",
  defer: (task) => {
    deferred.push(task());
  },
};

type Sent = { type: string; to: string; locale: string; email: { subject: string; text: string } };
const sent = (): Sent[] => mail.send.mock.calls.map((c) => (c as unknown as [Sent])[0]);
const flush = () => Promise.all(deferred);

beforeEach(() => {
  deferred = [];
  mail.send.mockClear();
  pin.setPin.mockReset();
});
afterEach(() => setTransport(null));

describe("loadAccess", () => {
  it("ověří tvar odpovědi databáze", async () => {
    fakeDb();
    expect((await loadAccess(ACTOR)).admins).toHaveLength(1);
    setTransport({ call: async () => ({ nesmysl: true }) });
    await expect(loadAccess(ACTOR)).rejects.toThrow();
  });
});

describe("addAdmin", () => {
  it("přidá správce s normalizovanou adresou a pošle oznámení novému, ostatním i na záložní adresu", async () => {
    const calls = fakeDb({
      admin_admin_add: { id: OTHER, notify: ["eva@example.test", "zaloha@example.test"] },
    });
    expect(await addAdmin(ACTOR, ctx, "  Druhy@Example.TEST ")).toEqual({ status: "added" });
    await flush();
    expect(calls.find((c) => c.fn === "admin_admin_add")!.args.p_email).toBe("druhy@example.test");
    const messages = sent();
    expect(messages.map((m) => [m.to, m.type])).toEqual([
      ["druhy@example.test", "admin_changed"],
      ["eva@example.test", "admin_changed"],
      ["zaloha@example.test", "admin_changed"],
    ]);
    expect(messages[0].email.subject).toMatch(/přidáni/);
    expect(messages[1].email.subject).toMatch(/přidán další správce/);
    // oznámení nesou odkaz na přihlášení a adresu webu, ne e-mail přidaného
    expect(messages[1].email.text).toContain("klara-a-matej.");
    expect(messages[1].email.text).not.toContain("druhy@example.test");
  });

  it("neplatný e-mail se odmítne před databází, stavy databáze se mapují", async () => {
    const calls = fakeDb();
    expect(await addAdmin(ACTOR, ctx, "bez-zavinace")).toEqual({ status: "invalid" });
    expect(await addAdmin(ACTOR, ctx, 42)).toEqual({ status: "invalid" });
    expect(calls).toEqual([]);

    fakeDb(
      {},
      { fail: { admin_admin_add: new DbError("admin_admin_add", "23505", "admin_exists") } },
    );
    expect(await addAdmin(ACTOR, ctx, "a@example.test")).toEqual({ status: "exists" });
    fakeDb(
      {},
      { fail: { admin_admin_add: new DbError("admin_admin_add", "23514", "max_admins_exceeded") } },
    );
    expect(await addAdmin(ACTOR, ctx, "a@example.test")).toEqual({ status: "full" });
    fakeDb({}, { fail: { admin_admin_add: new DbError("admin_admin_add", "XX000", "boom") } });
    await expect(addAdmin(ACTOR, ctx, "a@example.test")).rejects.toThrow();
    await flush();
    expect(sent()).toEqual([]);
  });

  it("po překročení limitu změn nic nezmění a nic neodešle", async () => {
    const calls = fakeDb({}, { rateAllowed: false });
    expect(await addAdmin(ACTOR, ctx, "a@example.test")).toEqual({
      status: "limited",
      retryAfter: 55,
    });
    expect(calls.map((c) => c.fn)).toEqual(["rate_limit_hit"]);
  });
});

describe("removeAdmin", () => {
  it("oznámí odebranému a ostatním, odebraný není mezi ostatními", async () => {
    fakeDb({
      admin_admin_remove: {
        removed: "druhy@example.test",
        notify: ["eva@example.test", "zaloha@example.test"],
      },
    });
    expect(await removeAdmin(ACTOR, ctx, OTHER)).toEqual({ status: "removed" });
    await flush();
    const messages = sent();
    expect(messages.map((m) => m.to)).toEqual([
      "druhy@example.test",
      "eva@example.test",
      "zaloha@example.test",
    ]);
    expect(messages[0].email.subject).toMatch(/skončil/);
    expect(messages[1].email.subject).toMatch(/odebrán správce/);
  });

  it("sám sebe a neexistujícího správce neodebere; neplatný identifikátor se odmítne", async () => {
    fakeDb(
      {},
      {
        fail: {
          admin_admin_remove: new DbError("admin_admin_remove", "55000", "cannot_remove_self"),
        },
      },
    );
    expect(await removeAdmin(ACTOR, ctx, ADMIN)).toEqual({ status: "self" });
    fakeDb(
      {},
      {
        fail: { admin_admin_remove: new DbError("admin_admin_remove", "P0002", "admin_not_found") },
      },
    );
    expect(await removeAdmin(ACTOR, ctx, OTHER)).toEqual({ status: "not_found" });
    expect(await removeAdmin(ACTOR, ctx, "nesmysl")).toEqual({ status: "not_found" });
  });
});

describe("setBackupEmail", () => {
  it("oznámí změnu staré adrese, nové adrese i správcům (každá adresa jednou)", async () => {
    fakeDb({
      admin_backup_email_set: {
        changed: true,
        old: "zaloha@example.test",
        notify: ["eva@example.test", "nova@example.test"],
      },
    });
    expect(await setBackupEmail(ACTOR, ctx, "Nova@Example.test")).toEqual({ status: "changed" });
    await flush();
    const byAddress = Object.fromEntries(sent().map((m) => [m.to, m.email.subject]));
    expect(Object.keys(byAddress).sort()).toEqual([
      "eva@example.test",
      "nova@example.test",
      "zaloha@example.test",
    ]);
    expect(byAddress["zaloha@example.test"]).toMatch(/už není záložní/);
    // nová adresa je nepotvrzená: dostane jedinou neutrální zprávu, ne oznámení o změně
    expect(byAddress["nova@example.test"]).toMatch(/Někdo vás uvedl/);
    expect(byAddress["eva@example.test"]).toMatch(/se změnil/);
    expect(sent()).toHaveLength(3);
  });

  it("nepotvrzená stará adresa (old = null) žádné oznámení nedostane", async () => {
    fakeDb({
      admin_backup_email_set: { changed: true, old: null, notify: ["eva@example.test"] },
    });
    expect(await setBackupEmail(ACTOR, ctx, "nova@example.test")).toEqual({ status: "changed" });
    await flush();
    expect(
      sent()
        .map((m) => m.to)
        .sort(),
    ).toEqual(["eva@example.test", "nova@example.test"]);
  });

  it("stejná adresa nic neposílá, neplatná se odmítne", async () => {
    fakeDb({ admin_backup_email_set: { changed: false } });
    expect(await setBackupEmail(ACTOR, ctx, "zaloha@example.test")).toEqual({ status: "same" });
    expect(await setBackupEmail(ACTOR, ctx, "nesmysl")).toEqual({ status: "invalid" });
    await flush();
    expect(sent()).toEqual([]);
  });
});

describe("PIN", () => {
  it("změna PINu volá setPin s relací správce a normalizovaným PINem", async () => {
    fakeDb();
    pin.setPin.mockResolvedValue({ status: "ok", backupEmail: "zaloha@example.test" });
    expect(await changePin(ACTOR, ctx, "guest", " 482 915 ")).toEqual({ status: "ok" });
    expect(pin.setPin).toHaveBeenCalledWith(
      expect.objectContaining({
        weddingId: WEDDING,
        slug: "klara-a-matej",
        role: "guest",
        pin: "482915",
        actorAdminId: ADMIN,
        keepSessionId: ACTOR.sessionId,
        origin: "https://app.se-vezmou.cz",
      }),
    );
  });

  it("chyba tvaru nebo shoda s druhým PINem se vrací jako stav", async () => {
    fakeDb();
    pin.setPin.mockResolvedValue({ status: "invalid", problem: "same_as_other" });
    expect(await changePin(ACTOR, ctx, "admin", "482915")).toEqual({
      status: "invalid",
      problem: "same_as_other",
    });
  });

  it("zapnutí PINu hostů bez nastaveného PINu je stav pin_missing", async () => {
    fakeDb({ admin_guest_pin_enabled_set: null });
    expect(await setGuestPinEnabled(ACTOR, true)).toEqual({ status: "ok" });
    fakeDb(
      {},
      {
        fail: {
          admin_guest_pin_enabled_set: new DbError(
            "admin_guest_pin_enabled_set",
            "55000",
            "pin_missing",
          ),
        },
      },
    );
    expect(await setGuestPinEnabled(ACTOR, true)).toEqual({ status: "pin_missing" });
    expect(await setGuestPinEnabled(ACTOR, "ano")).toEqual({ status: "pin_missing" });
  });
});

describe("zámek webu", () => {
  it("načte stav zámku k přístupu a zamknutí bez PINu hostů je stav pin_missing", async () => {
    fakeDb({}, { siteLocked: true });
    expect((await loadAccess(ACTOR)).site_locked).toBe(true);
    const calls = fakeDb({ admin_site_lock_set: null });
    expect(await setSiteLocked(ACTOR, true)).toEqual({ status: "ok" });
    expect(calls.find((c) => c.fn === "admin_site_lock_set")?.args).toEqual({ p_locked: true });
    fakeDb(
      {},
      {
        fail: {
          admin_site_lock_set: new DbError("admin_site_lock_set", "55000", "pin_missing"),
        },
      },
    );
    expect(await setSiteLocked(ACTOR, true)).toEqual({ status: "pin_missing" });
    expect(await setSiteLocked(ACTOR, "ano")).toEqual({ status: "pin_missing" });
  });
});

describe("souhlas s nahlédnutím", () => {
  it("udělení ověří důvod a dobu a rozešle oznámení s datem konce", async () => {
    const calls = fakeDb({
      grant_operator_access: {
        id: OTHER,
        expires_at: "2026-10-09T12:00:00Z",
        notify: ["eva@example.test", "zaloha@example.test"],
      },
    });
    expect(await grantAccess(ACTOR, ctx, { reason: "  Pomoc s importem ", days: 7 })).toEqual({
      status: "granted",
    });
    await flush();
    const grant = calls.find((c) => c.fn === "grant_operator_access")!;
    expect(grant.args).toEqual({ p_reason: "Pomoc s importem", p_days: 7 });
    expect(sent().map((m) => m.to)).toEqual(["eva@example.test", "zaloha@example.test"]);
    expect(sent()[0].email.text).toMatch(/9\.\s+října\s+2026/);
  });

  it("nepovolená doba a krátký důvod se odmítnou před databází", async () => {
    const calls = fakeDb();
    expect(await grantAccess(ACTOR, ctx, { reason: "Pomoc", days: 2 })).toEqual({
      status: "invalid",
    });
    expect(await grantAccess(ACTOR, ctx, { reason: "ab", days: 7 })).toEqual({ status: "invalid" });
    expect(await grantAccess(ACTOR, ctx, { reason: "x".repeat(501), days: 7 })).toEqual({
      status: "invalid",
    });
    expect(await grantAccess(ACTOR, ctx, null)).toEqual({ status: "invalid" });
    expect(calls).toEqual([]);
  });

  it("odvolání rozešle oznámení, cizí nebo odvolaný souhlas je not_found", async () => {
    fakeDb({ revoke_operator_access: { notify: ["eva@example.test"] } });
    expect(await revokeAccess(ACTOR, ctx, OTHER)).toEqual({ status: "revoked" });
    await flush();
    expect(sent()[0].email.subject).toMatch(/odvolán/);

    fakeDb(
      {},
      {
        fail: {
          revoke_operator_access: new DbError("revoke_operator_access", "P0002", "grant_not_found"),
        },
      },
    );
    expect(await revokeAccess(ACTOR, ctx, OTHER)).toEqual({ status: "not_found" });
    expect(await revokeAccess(ACTOR, ctx, "nesmysl")).toEqual({ status: "not_found" });
  });
});

describe("smazání webu", () => {
  it("vyžaduje potvrzovací slovo, jinak databázi nevolá", async () => {
    const calls = fakeDb();
    expect(await deleteSite(ACTOR, ctx, "ano")).toEqual({ status: "confirm_required" });
    expect(await deleteSite(ACTOR, ctx, undefined)).toEqual({ status: "confirm_required" });
    expect(calls).toEqual([]);
  });

  it("smaže web (slovo česky i anglicky, bez ohledu na velikost) a oznámí smazání bez odkazu", async () => {
    fakeDb({
      admin_wedding_delete: {
        purge_at: "2026-11-01T00:00:00Z",
        notify: ["eva@example.test", "zaloha@example.test"],
      },
    });
    expect(await deleteSite(ACTOR, ctx, " Smazat ")).toEqual({ status: "deleted" });
    await flush();
    expect(sent()).toHaveLength(2);
    expect(sent()[0].email.subject).toMatch(/smazán/);
    expect(sent()[0].email.text).toMatch(/1\.\s+listopadu\s+2026/);
    expect(sent()[0].email.text).not.toContain("https://app.");

    fakeDb({ admin_wedding_delete: { purge_at: null, notify: [] } });
    expect(await deleteSite(ACTOR, ctx, "DELETE")).toEqual({ status: "deleted" });
  });

  it("už smazaný web je stav", async () => {
    fakeDb(
      {},
      {
        fail: {
          admin_wedding_delete: new DbError("admin_wedding_delete", "P0002", "wedding_not_found"),
        },
      },
    );
    expect(await deleteSite(ACTOR, ctx, "smazat")).toEqual({ status: "not_found" });
  });
});

describe("notifyGuestDataViewed (OQ-53)", () => {
  it("pošle každé adrese jednou oznámení v jejím jazyce s důvodem provozovatele", async () => {
    fakeDb({
      guest_data_notice_recipients: [
        { email: "eva@example.test", locale: "cs" },
        { email: "EVA@example.test", locale: "cs" },
        { email: "alex@example.test", locale: "en" },
      ],
    });
    await notifyGuestDataViewed({ weddingId: WEDDING, reason: "Řešení importu", defer: ctx.defer });
    await flush();
    const messages = sent();
    expect(messages.map((m) => [m.to, m.locale])).toEqual([
      ["eva@example.test", "cs"],
      ["alex@example.test", "en"],
    ]);
    expect(messages[0].email.subject).toMatch(/nahlédl/);
    expect(messages[0].email.text).toContain("Řešení importu");
    expect(messages[1].email.subject).toMatch(/viewed/);
  });

  it("selhání oznámení nahlédnutí neblokuje a nevyhazuje výjimku", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fakeDb(
      {},
      {
        fail: {
          guest_data_notice_recipients: new DbError(
            "guest_data_notice_recipients",
            "XX000",
            "boom",
          ),
        },
      },
    );
    await expect(
      notifyGuestDataViewed({ weddingId: WEDDING, reason: "Důvod", defer: ctx.defer }),
    ).resolves.toBeUndefined();
    expect(sent()).toEqual([]);
    error.mockRestore();
  });
});
