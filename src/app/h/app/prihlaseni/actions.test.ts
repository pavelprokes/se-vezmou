import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET = "auth-secret-auth-secret-auth-secret-1";
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
  process.env.PIN_PEPPER = "pepper-pepper-pepper-pepper-pepper-0001";
});

const state = vi.hoisted(() => ({
  headers: new Map<string, string>(),
  cookies: new Map<string, string>(),
  set: [] as { name: string; value: string; [key: string]: unknown }[],
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => state.headers.get(name.toLowerCase()) ?? null }),
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
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => void task }));

const login = vi.hoisted(() => ({
  requestLoginCode: vi.fn(),
  verifyLoginCode: vi.fn(),
  openLoginLink: vi.fn(),
  openPendingLogin: vi.fn(),
  sealPendingLogin: vi.fn(() => "zapecetene"),
}));
vi.mock("@/auth/login", () => login);
const pin = vi.hoisted(() => ({ loginWithPin: vi.fn() }));
vi.mock("@/auth/pin-login", () => pin);
const session = vi.hoisted(() => ({
  startAdminSession: vi.fn(async () => undefined),
  endSession: vi.fn(async () => undefined),
}));
vi.mock("@/auth/session", () => session);

import {
  confirmLinkAction,
  logoutAction,
  pinLoginAction,
  requestCodeAction,
  verifyCodeAction,
} from "./actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function redirectTarget(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const match = /^REDIRECT (.+)$/.exec((error as Error).message);
    if (!match) throw error;
    return match[1];
  }
}

beforeEach(() => {
  state.headers = new Map([
    ["host", "app.se-vezmou.cz"],
    ["origin", "https://app.se-vezmou.cz"],
    ["accept-language", "cs-CZ,cs;q=0.9"],
    ["x-forwarded-for", "203.0.113.7"],
  ]);
  state.cookies = new Map();
  state.set = [];
  vi.stubEnv("VERCEL", "");
});

const WEDDING = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";

describe("kontrola původu (CSRF) u každé mutace", () => {
  const cases: [string, () => Promise<unknown>][] = [
    ["requestCodeAction", () => requestCodeAction(null, form({ email: "klara@example.cz" }))],
    ["verifyCodeAction", () => verifyCodeAction(null, form({ code: "123456" }))],
    ["confirmLinkAction", () => confirmLinkAction(null, form({ t: "x" }))],
    ["pinLoginAction", () => pinLoginAction(null, form({ slug: "a-b", pin: "482915" }))],
  ];

  for (const [name, run] of cases) {
    it(`${name}: chybějící Origin se odmítne a nic se neprovede`, async () => {
      state.headers.delete("origin");
      expect(await run()).toEqual({ error: "generic" });
    });

    it(`${name}: cizí Origin se odmítne a nic se neprovede`, async () => {
      state.headers.set("origin", "https://evil.example");
      expect(await run()).toEqual({ error: "generic" });
    });

    it(`${name}: Origin jiného hostitele téže domény se odmítne`, async () => {
      state.headers.set("origin", "https://klara-a-matej.se-vezmou.cz");
      expect(await run()).toEqual({ error: "generic" });
    });
  }

  it("odmítnuté požadavky nezavolají přihlašování ani relace", async () => {
    state.headers.delete("origin");
    for (const [, run] of cases) await run();
    await redirectTarget(logoutAction());
    expect(login.requestLoginCode).not.toHaveBeenCalled();
    expect(login.verifyLoginCode).not.toHaveBeenCalled();
    expect(pin.loginWithPin).not.toHaveBeenCalled();
    expect(session.startAdminSession).not.toHaveBeenCalled();
    expect(session.endSession).not.toHaveBeenCalled();
    expect(state.set).toHaveLength(0);
  });

  it("odhlášení z cizího původu relaci neukončí (nejde vynutit cizí stránkou)", async () => {
    state.headers.set("origin", "https://evil.example");
    expect(await redirectTarget(logoutAction())).toBe("/prihlaseni");
    expect(session.endSession).not.toHaveBeenCalled();
  });

  it("odhlášení ze správného původu relaci ukončí", async () => {
    expect(await redirectTarget(logoutAction())).toBe("/prihlaseni");
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});

describe("requestCodeAction", () => {
  it("neplatný e-mail: chyba u pole, nic se neodešle", async () => {
    expect(await requestCodeAction(null, form({ email: "klara" }))).toEqual({
      error: "invalid_email",
      value: "klara",
    });
    expect(login.requestLoginCode).not.toHaveBeenCalled();
  });

  it("úspěch: cookie rozpracovaného přihlášení má atributy __Host- a přesměruje na kód", async () => {
    login.requestLoginCode.mockResolvedValue({ status: "sent" });
    const target = await redirectTarget(
      requestCodeAction(null, form({ email: " Klara@Example.CZ " })),
    );
    expect(target).toBe("/prihlaseni/kod");
    expect(login.requestLoginCode).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "klara@example.cz",
        ip: "203.0.113.7",
        locale: "cs",
        origin: "https://app.se-vezmou.cz",
      }),
    );
    expect(state.set).toEqual([
      expect.objectContaining({
        name: "__Host-sv_login",
        value: "zapecetene",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      }),
    ]);
    expect(state.set[0]).not.toHaveProperty("domain");
  });

  it("překročený limit: obecná chyba a žádná cookie", async () => {
    login.requestLoginCode.mockResolvedValue({ status: "limited", retryAfter: 60 });
    expect(await requestCodeAction(null, form({ email: "klara@example.cz" }))).toEqual({
      error: "limited",
      value: "klara@example.cz",
    });
    expect(state.set).toHaveLength(0);
  });

  it("jazyk e-mailu je jazyk požadavku z proxy (hlavička x-ui-locale) a přesměrování ho nese", async () => {
    state.headers.set("x-ui-locale", "en");
    login.requestLoginCode.mockResolvedValue({ status: "sent" });
    const target = await redirectTarget(
      requestCodeAction(null, form({ email: "klara@example.cz" })),
    );
    expect(login.requestLoginCode).toHaveBeenCalledWith(expect.objectContaining({ locale: "en" }));
    expect(target).toBe("/en/prihlaseni/kod");
  });

  it("Accept-Language server nečte: bez jazyka z proxy je e-mail ve výchozím jazyce", async () => {
    state.headers.set("accept-language", "en-GB,en;q=0.9");
    state.headers.set("x-ui-locale", "nesmysl");
    login.requestLoginCode.mockResolvedValue({ status: "sent" });
    const target = await redirectTarget(
      requestCodeAction(null, form({ email: "klara@example.cz" })),
    );
    expect(login.requestLoginCode).toHaveBeenCalledWith(expect.objectContaining({ locale: "cs" }));
    expect(target).toBe("/prihlaseni/kod");
  });
});

describe("verifyCodeAction", () => {
  beforeEach(() => {
    state.cookies.set("__Host-sv_login", "zapecetene");
    login.openPendingLogin.mockReturnValue("klara@example.cz");
  });

  it("bez rozpracovaného přihlášení: vypršelo", async () => {
    state.cookies.clear();
    expect(await verifyCodeAction(null, form({ code: "123456" }))).toEqual({ error: "expired" });
    expect(login.verifyLoginCode).not.toHaveBeenCalled();
  });

  it("nesmyslný kód: formát, bez dotazu na databázi", async () => {
    expect(await verifyCodeAction(null, form({ code: "12" }))).toEqual({ error: "format" });
    expect(login.verifyLoginCode).not.toHaveBeenCalled();
  });

  it("chybný kód: wrong", async () => {
    login.verifyLoginCode.mockResolvedValue({ status: "invalid" });
    expect(await verifyCodeAction(null, form({ code: "123 456" }))).toEqual({ error: "wrong" });
    expect(login.verifyLoginCode).toHaveBeenCalledWith({
      email: "klara@example.cz",
      code: "123456",
      ip: "203.0.113.7",
    });
    expect(session.startAdminSession).not.toHaveBeenCalled();
  });

  it("limit: limited", async () => {
    login.verifyLoginCode.mockResolvedValue({ status: "limited", retryAfter: 5 });
    expect(await verifyCodeAction(null, form({ code: "123456" }))).toEqual({ error: "limited" });
  });

  it("platný kód: založí relaci, zruší rozpracované přihlášení a přesměruje do správy", async () => {
    login.verifyLoginCode.mockResolvedValue({ status: "ok", weddingId: WEDDING, adminId: ADMIN });
    expect(await redirectTarget(verifyCodeAction(null, form({ code: "123456" })))).toBe("/");
    expect(session.startAdminSession).toHaveBeenCalledWith(WEDDING, ADMIN);
    expect(state.set).toEqual([
      expect.objectContaining({ name: "__Host-sv_login", value: "", maxAge: 0 }),
    ]);
  });
});

describe("confirmLinkAction", () => {
  it("neplatný odkaz: wrong a bez ověřování", async () => {
    login.openLoginLink.mockReturnValue(null);
    expect(await confirmLinkAction(null, form({ t: "x" }))).toEqual({ error: "wrong" });
    expect(await confirmLinkAction(null, form({}))).toEqual({ error: "wrong" });
    expect(login.verifyLoginCode).not.toHaveBeenCalled();
  });

  it("platný odkaz: přihlásí", async () => {
    login.openLoginLink.mockReturnValue({ email: "klara@example.cz", code: "123456" });
    login.verifyLoginCode.mockResolvedValue({ status: "ok", weddingId: WEDDING, adminId: ADMIN });
    expect(await redirectTarget(confirmLinkAction(null, form({ t: "x" })))).toBe("/");
    expect(session.startAdminSession).toHaveBeenCalledWith(WEDDING, ADMIN);
  });
});

describe("pinLoginAction", () => {
  it("předá adresu a PIN bez mezer a lokalitu", async () => {
    pin.loginWithPin.mockResolvedValue({ status: "invalid" });
    const result = await pinLoginAction(
      null,
      form({ slug: "https://Klara-A-Matej.se-vezmou.cz/", pin: "482 915" }),
    );
    expect(result).toMatchObject({ error: "invalid" });
    expect(pin.loginWithPin).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "klara-a-matej", pin: "482915", locale: "cs" }),
    );
  });

  it("pauza: chyba locked s délkou slovy", async () => {
    pin.loginWithPin.mockResolvedValue({ status: "locked", retryAfter: 900 });
    expect(await pinLoginAction(null, form({ slug: "a-b", pin: "482915" }))).toEqual({
      error: "locked",
      value: "a-b",
      pause: "15 minut",
    });
  });

  it("úspěch: relace a přesměrování", async () => {
    pin.loginWithPin.mockResolvedValue({ status: "ok", weddingId: WEDDING, adminId: ADMIN });
    expect(await redirectTarget(pinLoginAction(null, form({ slug: "a-b", pin: "482915" })))).toBe(
      "/",
    );
    expect(session.startAdminSession).toHaveBeenCalledWith(WEDDING, ADMIN);
  });

  it("neplatná adresa se předá jako null (nemůže existovat)", async () => {
    pin.loginWithPin.mockResolvedValue({ status: "invalid" });
    await pinLoginAction(null, form({ slug: "špatně!", pin: "482915" }));
    expect(pin.loginWithPin).toHaveBeenCalledWith(expect.objectContaining({ slug: null }));
  });
});
