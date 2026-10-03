import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET = "auth-secret-auth-secret-auth-secret-1";
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
  process.env.OPERATOR_MFA_KEY = "operator-mfa-key-operator-mfa-key-0001";
});

vi.mock("@/lib/email/transport", () => ({
  sendEmail: vi.fn(async () => ({ providerMessageId: "msg-1" })),
}));

import { codeHash, emailHash } from "@/auth/identity";
import { setTransport } from "@/lib/db/rpc";
import type { RpcTransport } from "@/lib/db/transport";
import { sendEmail } from "@/lib/email/transport";
import { hashBackupCode, normalizeBackupCode } from "./backup-codes";
import {
  confirmEnrollment,
  loadEnrollment,
  regenerateBackupCodes,
  requestOperatorCode,
  verifyOperatorCode,
  verifySecondFactor,
} from "./login";
import { decryptTotpSecret, encryptTotpSecret } from "./mfa-secret";
import type { OperatorSession } from "./session";
import { base32Decode, timeStep, totpAt } from "./totp";

const AUTH_SECRET = process.env.AUTH_SECRET!;
const KEY = process.env.OPERATOR_MFA_KEY!;
const OPERATOR = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const SECRET = "JBSWY3DPEHPK3PXP";
const NOW = 1_800_000_000_000;

const session: OperatorSession = {
  sessionId: SESSION_ID,
  operatorId: OPERATOR,
  email: "majitel@example.cz",
  role: "owner",
  aal2: false,
  totpConfirmed: true,
};

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
const deny: Handler = () => [{ allowed: false, retry_after: 600 }];
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

beforeEach(() => sendMock.mockClear());
afterEach(() => setTransport(null));

const found = [{ operator_id: OPERATOR, role: "owner", totp_confirmed: true }];

describe("requestOperatorCode", () => {
  const base = { email: "majitel@example.cz", ip: "203.0.113.7" };

  it("známý operátor: výzva `operator_login` jen jako hash, e-mail až po odpovědi", async () => {
    const db = fakeDb({
      rate_limit_hit: allow,
      auth_operator_find: () => found,
      auth_create_challenge: () => "challenge-id",
      ...logHandlers,
    });
    const d = deferred();

    expect(await requestOperatorCode({ ...base, defer: d.defer })).toEqual({ status: "sent" });
    expect(sendMock).not.toHaveBeenCalled();
    expect(d.tasks).toHaveLength(1);

    const challenge = db.calls.find((c) => c.fn === "auth_create_challenge")!;
    expect(challenge.args.p_purpose).toBe("operator_login");
    expect(challenge.args.p_ttl_seconds).toBe(600);
    const rest = JSON.stringify(db.calls.filter((c) => c.fn !== "auth_operator_find"));
    expect(rest).not.toContain("majitel");
    expect(rest).not.toContain("203.0.113.7");

    await d.runAll();
    const message = sendMock.mock.calls[0][0];
    expect(message.to).toBe("majitel@example.cz");
    expect(message.subject).toBe("Přihlašovací kód do provozní administrace");
    const code = /^(\d{6})$/m.exec(message.text)![1];
    expect(
      codeHash(AUTH_SECRET, "majitel@example.cz", code).equals(
        challenge.args.p_code_hash as Buffer,
      ),
    ).toBe(true);
    expect(
      emailHash(AUTH_SECRET, "majitel@example.cz").equals(challenge.args.p_email_hash as Buffer),
    ).toBe(true);
  });

  it("neznámý e-mail: stejná odpověď a stejná práce v databázi, e-mail se neposílá", async () => {
    const known = fakeDb({
      rate_limit_hit: allow,
      auth_operator_find: () => found,
      auth_create_challenge: () => "challenge-id",
      ...logHandlers,
    });
    const d1 = deferred();
    const first = await requestOperatorCode({ ...base, defer: d1.defer });

    const unknown = fakeDb({
      rate_limit_hit: allow,
      auth_operator_find: () => [],
      auth_create_challenge: () => "challenge-id",
      ...logHandlers,
    });
    const d2 = deferred();
    const second = await requestOperatorCode({
      ...base,
      email: "cizi@example.cz",
      defer: d2.defer,
    });

    expect(second).toEqual(first);
    expect(unknown.names()).toEqual(known.names());
    expect(d2.tasks).toHaveLength(0);
    await d2.runAll();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("po překročení limitu e-mailu je odpověď stejná, ale výzva ani e-mail nevzniknou", async () => {
    let n = 0;
    const db = fakeDb({
      rate_limit_hit: () => [{ allowed: ++n === 1, retry_after: 600 }],
      auth_operator_find: () => found,
      auth_create_challenge: () => "challenge-id",
      ...logHandlers,
    });
    const d = deferred();
    expect(await requestOperatorCode({ ...base, defer: d.defer })).toEqual({ status: "sent" });
    expect(db.names()).not.toContain("auth_create_challenge");
    expect(d.tasks).toHaveLength(0);
  });

  it("limit podle IP vrátí `limited` a nic dalšího nevolá", async () => {
    const db = fakeDb({ rate_limit_hit: deny });
    const d = deferred();
    expect(await requestOperatorCode({ ...base, defer: d.defer })).toEqual({
      status: "limited",
      retryAfter: 600,
    });
    expect(db.names()).toEqual(["rate_limit_hit"]);
  });

  it("selhání úložiště omezení = výjimka (zavřeně)", async () => {
    fakeDb({
      rate_limit_hit: () => {
        throw new Error("db");
      },
    });
    await expect(requestOperatorCode({ ...base, defer: deferred().defer })).rejects.toThrow();
  });
});

describe("verifyOperatorCode", () => {
  it("správný kód a aktivní operátor", async () => {
    const db = fakeDb({
      rate_limit_hit: allow,
      auth_verify_challenge: () => true,
      auth_operator_find: () => found,
    });
    expect(
      await verifyOperatorCode({ email: "majitel@example.cz", code: "123456", ip: "203.0.113.7" }),
    ).toEqual({ status: "ok", operatorId: OPERATOR, totpConfirmed: true });
    expect(db.calls.find((c) => c.fn === "auth_verify_challenge")!.args.p_purpose).toBe(
      "operator_login",
    );
  });

  it("chybný kód i operátor odebraný mezitím jsou stejné `invalid`", async () => {
    fakeDb({ rate_limit_hit: allow, auth_verify_challenge: () => false });
    expect(
      await verifyOperatorCode({ email: "majitel@example.cz", code: "000000", ip: "1.1.1.1" }),
    ).toEqual({ status: "invalid" });
    fakeDb({
      rate_limit_hit: allow,
      auth_verify_challenge: () => true,
      auth_operator_find: () => [],
    });
    expect(
      await verifyOperatorCode({ email: "majitel@example.cz", code: "123456", ip: "1.1.1.1" }),
    ).toEqual({ status: "invalid" });
  });

  it("limit podle IP", async () => {
    fakeDb({ rate_limit_hit: deny });
    expect(
      await verifyOperatorCode({ email: "majitel@example.cz", code: "123456", ip: "1.1.1.1" }),
    ).toEqual({ status: "limited", retryAfter: 600 });
  });
});

describe("verifySecondFactor", () => {
  const encrypted = encryptTotpSecret(KEY, OPERATOR, SECRET);
  const mfa = (lastStep: number | null = null) => [
    { secret_enc: encrypted, confirmed: true, last_step: lastStep },
  ];
  const gate = {
    rate_limit_hit: allow,
    auth_lockout_state: () => [{ locked: false, retry_after: 0 }],
    auth_lockout_reset: () => null,
    auth_lockout_failure: () => [{ locked: false, retry_after: 0, level: 0, newly_locked: false }],
    ...logHandlers,
  };

  it("platný kód z aplikace: přijme časový krok, nuluje pauzu a pošle oznámení", async () => {
    const db = fakeDb({
      ...gate,
      auth_operator_mfa_get: () => mfa(),
      auth_operator_mfa_accept: () => true,
    });
    const d = deferred();
    const result = await verifySecondFactor({
      session,
      value: ` ${totpAt(SECRET, NOW).slice(0, 3)} ${totpAt(SECRET, NOW).slice(3)} `,
      ip: "203.0.113.7",
      defer: d.defer,
      now: NOW,
    });
    expect(result).toEqual({ status: "ok", usedBackupCode: false });
    const accept = db.calls.find((c) => c.fn === "auth_operator_mfa_accept")!;
    expect(accept.args).toMatchObject({
      p_operator_id: OPERATOR,
      p_session_id: SESSION_ID,
      p_step: timeStep(NOW),
    });
    expect(db.names()).toContain("auth_lockout_reset");
    await d.runAll();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].subject).toBe("Přihlášení do provozní administrace");
  });

  it("kód z už použitého kroku se odmítne a započítá jako chyba", async () => {
    const db = fakeDb({
      ...gate,
      auth_operator_mfa_get: () => mfa(timeStep(NOW)),
      auth_operator_mfa_accept: () => true,
    });
    const result = await verifySecondFactor({
      session,
      value: totpAt(SECRET, NOW),
      ip: "203.0.113.7",
      defer: deferred().defer,
      now: NOW,
    });
    expect(result).toEqual({ status: "invalid" });
    expect(db.names()).not.toContain("auth_operator_mfa_accept");
    expect(db.names()).toContain("auth_lockout_failure");
  });

  it("souběžné použití téhož kódu: databáze krok nepřijme, přihlášení neprojde", async () => {
    fakeDb({ ...gate, auth_operator_mfa_get: () => mfa(), auth_operator_mfa_accept: () => false });
    expect(
      await verifySecondFactor({
        session,
        value: totpAt(SECRET, NOW),
        ip: "1.1.1.1",
        defer: deferred().defer,
        now: NOW,
      }),
    ).toEqual({ status: "invalid" });
  });

  it("chybný kód: `invalid`, po sérii chyb pauza", async () => {
    fakeDb({
      ...gate,
      auth_operator_mfa_get: () => mfa(),
      auth_lockout_failure: () => [
        { locked: true, retry_after: 900, level: 1, newly_locked: true },
      ],
    });
    expect(
      await verifySecondFactor({
        session,
        value: "000000",
        ip: "1.1.1.1",
        defer: deferred().defer,
        now: NOW,
      }),
    ).toEqual({ status: "locked", retryAfter: 900 });
  });

  it("v době pauzy se kód vůbec neověřuje", async () => {
    const db = fakeDb({
      ...gate,
      auth_lockout_failure: () => [
        { locked: true, retry_after: 600, level: 1, newly_locked: false },
      ],
      auth_operator_mfa_get: () => mfa(),
    });
    expect(
      await verifySecondFactor({
        session,
        value: totpAt(SECRET, NOW),
        ip: "1.1.1.1",
        defer: deferred().defer,
        now: NOW,
      }),
    ).toEqual({ status: "locked", retryAfter: 600 });
    expect(db.names()).not.toContain("auth_operator_mfa_get");
  });

  it("limit podle IP", async () => {
    fakeDb({ rate_limit_hit: deny });
    expect(
      await verifySecondFactor({
        session,
        value: "123456",
        ip: "1.1.1.1",
        defer: deferred().defer,
      }),
    ).toEqual({ status: "limited", retryAfter: 600 });
  });

  it("špatný tvar se nezapočítá jako chyba a nesáhne na databázi s faktorem", async () => {
    const db = fakeDb({ ...gate });
    expect(
      await verifySecondFactor({
        session,
        value: "abc",
        ip: "1.1.1.1",
        defer: deferred().defer,
      }),
    ).toEqual({ status: "format" });
    expect(db.names()).not.toContain("auth_lockout_failure");
    expect(db.names()).not.toContain("auth_operator_mfa_get");
  });

  it("záložní kód: hash svázaný s operátorem, oznámení e-mailem se zbývajícím počtem", async () => {
    const db = fakeDb({
      ...gate,
      auth_operator_mfa_get: () => mfa(),
      auth_operator_use_backup_code: () => 7,
    });
    const d = deferred();
    const result = await verifySecondFactor({
      session,
      value: "abcde-fghjk",
      ip: "1.1.1.1",
      defer: d.defer,
    });
    expect(result).toEqual({ status: "ok", usedBackupCode: true });
    const used = db.calls.find((c) => c.fn === "auth_operator_use_backup_code")!;
    expect(
      hashBackupCode(KEY, OPERATOR, "ABCDEFGHJK").equals(used.args.p_code_hash as Buffer),
    ).toBe(true);
    await d.runAll();
    expect(sendMock.mock.calls[0][0].subject).toBe("Použit záložní kód");
    expect(sendMock.mock.calls[0][0].text).toContain("Zbývá 7");
  });

  it("neplatný záložní kód je chyba druhého faktoru", async () => {
    const db = fakeDb({
      ...gate,
      auth_operator_mfa_get: () => mfa(),
      auth_operator_use_backup_code: () => -1,
    });
    expect(
      await verifySecondFactor({
        session,
        value: "ABCDEFGHJK",
        ip: "1.1.1.1",
        defer: deferred().defer,
      }),
    ).toEqual({ status: "invalid" });
    expect(db.names()).toContain("auth_lockout_failure");
  });

  it("operátor bez potvrzeného faktoru se tudy nepřihlásí", async () => {
    fakeDb({
      ...gate,
      auth_operator_mfa_get: () => [{ secret_enc: null, confirmed: false, last_step: null }],
    });
    expect(
      await verifySecondFactor({
        session,
        value: "123456",
        ip: "1.1.1.1",
        defer: deferred().defer,
      }),
    ).toEqual({ status: "invalid" });
  });

  it("klíč zašifrovaný jiným klíčem nejde přečíst: výjimka, ne přijetí", async () => {
    fakeDb({
      ...gate,
      auth_operator_mfa_get: () => [
        {
          secret_enc: encryptTotpSecret("jiny-klic-jiny-klic-jiny-klic-0002", OPERATOR, SECRET),
          confirmed: true,
          last_step: null,
        },
      ],
    });
    await expect(
      verifySecondFactor({
        session,
        value: totpAt(SECRET, NOW),
        ip: "1.1.1.1",
        defer: deferred().defer,
        now: NOW,
      }),
    ).rejects.toThrow("OPERATOR_MFA_KEY");
  });
});

describe("zápis druhého faktoru", () => {
  it("první otevření uloží zašifrovaný klíč, nikdy ne čitelný", async () => {
    let stored: string | null = null;
    const db = fakeDb({
      auth_operator_mfa_get: () => [{ secret_enc: stored, confirmed: false, last_step: null }],
      auth_operator_mfa_begin: (args) => (stored = args.p_secret_enc as string),
    });
    const enrollment = await loadEnrollment({ ...session, totpConfirmed: false });
    expect(enrollment).not.toBeNull();
    expect(base32Decode(enrollment!.secret)).toHaveLength(20);
    expect(enrollment!.uri).toContain(`secret=${enrollment!.secret}`);
    expect(enrollment!.uri).toContain("otpauth://totp/");
    const begin = db.calls.find((c) => c.fn === "auth_operator_mfa_begin")!;
    expect(String(begin.args.p_secret_enc)).not.toContain(enrollment!.secret);
    expect(decryptTotpSecret(KEY, OPERATOR, begin.args.p_secret_enc as string)).toBe(
      enrollment!.secret,
    );

    // druhé otevření ukáže tentýž klíč a nic nepřepíše
    const again = await loadEnrollment({ ...session, totpConfirmed: false });
    expect(again!.secret).toBe(enrollment!.secret);
    expect(db.calls.filter((c) => c.fn === "auth_operator_mfa_begin")).toHaveLength(1);
  });

  it("potvrzený faktor se znovu nezobrazí", async () => {
    fakeDb({
      auth_operator_mfa_get: () => [{ secret_enc: "x", confirmed: true, last_step: 5 }],
    });
    expect(await loadEnrollment(session)).toBeNull();
  });

  const gate = {
    rate_limit_hit: allow,
    auth_lockout_state: () => [{ locked: false, retry_after: 0 }],
    auth_lockout_reset: () => null,
    auth_lockout_failure: () => [{ locked: false, retry_after: 0, level: 0, newly_locked: false }],
    ...logHandlers,
  };
  const pending = { ...session, totpConfirmed: false };
  const enc = encryptTotpSecret(KEY, OPERATOR, SECRET);

  it("potvrzení kódem uloží jen hashe záložních kódů a vrátí jejich čitelnou podobu", async () => {
    const db = fakeDb({
      ...gate,
      auth_operator_mfa_get: () => [{ secret_enc: enc, confirmed: false, last_step: null }],
      auth_operator_mfa_confirm: () => true,
    });
    const d = deferred();
    const result = await confirmEnrollment({
      session: pending,
      value: totpAt(SECRET, NOW),
      ip: "1.1.1.1",
      defer: d.defer,
      now: NOW,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.backupCodes).toHaveLength(10);
    const confirm = db.calls.find((c) => c.fn === "auth_operator_mfa_confirm")!;
    expect(confirm.args.p_step).toBe(timeStep(NOW));
    const hashes = confirm.args.p_backup_hashes as Buffer[];
    expect(hashes).toHaveLength(10);
    result.backupCodes.forEach((code, index) => {
      expect(hashes[index].equals(hashBackupCode(KEY, OPERATOR, normalizeBackupCode(code)!))).toBe(
        true,
      );
    });
    expect(JSON.stringify(confirm.args)).not.toContain(result.backupCodes[0]);
  });

  it("chybný kód zápis nepotvrdí a započítá se jako chyba", async () => {
    const db = fakeDb({
      ...gate,
      auth_operator_mfa_get: () => [{ secret_enc: enc, confirmed: false, last_step: null }],
    });
    const result = await confirmEnrollment({
      session: pending,
      value: "000000",
      ip: "1.1.1.1",
      defer: deferred().defer,
      now: NOW,
    });
    expect(result).toEqual({ status: "invalid" });
    expect(db.names()).not.toContain("auth_operator_mfa_confirm");
  });

  it("nová sada záložních kódů: jen s kódem z aplikace, hashe do databáze, oznámení e-mailem", async () => {
    const db = fakeDb({
      ...gate,
      auth_operator_mfa_get: () => [{ secret_enc: enc, confirmed: true, last_step: null }],
      auth_operator_mfa_accept: () => true,
      auth_operator_regenerate_backup_codes: () => 10,
    });
    const d = deferred();
    const result = await regenerateBackupCodes({
      session: { ...session, aal2: true },
      value: totpAt(SECRET, NOW),
      ip: "1.1.1.1",
      defer: d.defer,
      now: NOW,
    });
    expect(result.status === "ok" && result.backupCodes).toHaveLength(10);
    const stored = db.calls.find((c) => c.fn === "auth_operator_regenerate_backup_codes")!;
    expect((stored.args.p_backup_hashes as Buffer[]).every((hash) => hash.length === 32)).toBe(
      true,
    );
    await d.runAll();
    expect(sendMock.mock.calls[0][0].subject).toBe("Vygenerována nová sada záložních kódů");
  });

  it("nová sada záložních kódů: bez platného kódu z aplikace nic nevznikne", async () => {
    const db = fakeDb({
      ...gate,
      auth_operator_mfa_get: () => [{ secret_enc: enc, confirmed: true, last_step: null }],
    });
    const base = {
      session: { ...session, aal2: true },
      ip: "1.1.1.1",
      defer: deferred().defer,
      now: NOW,
    };
    expect(await regenerateBackupCodes({ ...base, value: "" })).toEqual({ status: "format" });
    expect(await regenerateBackupCodes({ ...base, value: "000000" })).toEqual({
      status: "invalid",
    });
    expect(db.names()).not.toContain("auth_operator_regenerate_backup_codes");
    expect(db.names()).toContain("auth_lockout_failure");
  });
});
