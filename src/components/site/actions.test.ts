import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantFromRequest: vi.fn(),
  currentTicket: vi.fn(),
  setTicket: vi.fn(),
  clearTicket: vi.fn(),
  clearInvite: vi.fn(),
  getSiteState: vi.fn(),
  matchStep: vi.fn(),
  submitStep: vi.fn(),
  unlistedStep: vi.fn(),
  unlockWithGuestPin: vi.fn(),
  setGuestCookie: vi.fn(),
  getClientIp: vi.fn(),
  after: vi.fn(),
}));

vi.mock("@/site/tenant-request", () => ({
  tenantFromRequest: mocks.tenantFromRequest,
  currentTicket: mocks.currentTicket,
  setTicket: mocks.setTicket,
  clearTicket: mocks.clearTicket,
  clearInvite: mocks.clearInvite,
}));
vi.mock("@/site/content", () => ({ getSiteState: mocks.getSiteState }));
vi.mock("@/lib/rsvp/service", () => ({
  matchStep: mocks.matchStep,
  submitStep: mocks.submitStep,
  unlistedStep: mocks.unlistedStep,
}));
vi.mock("@/auth/guest-pin", () => ({ unlockWithGuestPin: mocks.unlockWithGuestPin }));
vi.mock("@/auth/guest-session", () => ({ setGuestCookie: mocks.setGuestCookie }));
vi.mock("@/auth/request", () => ({ getClientIp: mocks.getClientIp }));
vi.mock("next/server", () => ({ after: mocks.after }));

import { matchAction, resetAction, submitAction, unlistedAction, unlockAction } from "./actions";

const tenant = {
  slug: "klara-a-matej",
  weddingId: "11111111-1111-4111-8111-111111111111",
  locale: "cs",
  origin: "https://klara-a-matej.se-vezmou.cz",
};

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getSiteState.mockResolvedValue({ kind: "published" });
  mocks.tenantFromRequest.mockResolvedValue(tenant);
  mocks.getClientIp.mockResolvedValue("198.51.100.7");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("Server Actions webu páru: RSVP", () => {
  it("svatba se určuje z hostitele a jazyk z pole; cizí původ nebo jiný hostitel dá obecný stav", async () => {
    mocks.matchStep.mockResolvedValue({ state: { stage: "name", error: "not_found", value: "x" } });
    await matchAction(form({ name: "Jan Novák", locale: "en", website: "" }));
    expect(mocks.tenantFromRequest).toHaveBeenCalledWith("en");
    expect(mocks.matchStep).toHaveBeenCalledWith({
      weddingId: tenant.weddingId,
      slug: tenant.slug,
      ip: "198.51.100.7",
      name: "Jan Novák",
      locale: "cs",
      honeypot: "",
    });

    mocks.tenantFromRequest.mockResolvedValue(null);
    mocks.matchStep.mockClear();
    expect(await matchAction(form({ name: "Jan Novák" }))).toEqual({
      stage: "name",
      error: "generic",
    });
    expect(await submitAction(form({ mode: "listed" }))).toEqual({
      stage: "name",
      error: "generic",
    });
    expect(await unlistedAction(form({}))).toEqual({ stage: "name", error: "generic" });
    expect(await resetAction(form({}))).toEqual({ stage: "name", error: "generic" });
    expect(mocks.matchStep).not.toHaveBeenCalled();
    expect(mocks.submitStep).not.toHaveBeenCalled();
  });

  it('lístek ze služby se uloží do cookie, "clear" ji smaže, bez pokynu se cookie nemění', async () => {
    mocks.matchStep.mockResolvedValue({
      state: { stage: "form" },
      ticket: { set: "t".repeat(64) },
    });
    await matchAction(form({ name: "Jan" }));
    expect(mocks.setTicket).toHaveBeenCalledWith("t".repeat(64));
    // ověřené jméno zapomene osobní odkaz: odpověď jde domácnosti podle jména
    expect(mocks.clearInvite).toHaveBeenCalledTimes(1);

    mocks.matchStep.mockResolvedValue({ state: { stage: "name", error: "not_found" } });
    mocks.setTicket.mockClear();
    mocks.clearInvite.mockClear();
    await matchAction(form({ name: "Jan" }));
    expect(mocks.setTicket).not.toHaveBeenCalled();
    expect(mocks.clearInvite).not.toHaveBeenCalled();
    expect(mocks.clearTicket).not.toHaveBeenCalled();

    mocks.submitStep.mockResolvedValue({ state: { stage: "closed" }, ticket: { clear: true } });
    await submitAction(form({ mode: "listed" }));
    expect(mocks.clearTicket).toHaveBeenCalledTimes(1);
  });

  it("odeslání bere lístek z cookie nebo osobního odkazu, ne z formuláře; host mimo seznam lístek nemá", async () => {
    mocks.currentTicket.mockResolvedValue("c".repeat(64));
    mocks.submitStep.mockResolvedValue({ state: { stage: "form" } });
    const data = form({ mode: "listed", ticket: "podvržený", locale: "cs" });
    await submitAction(data);
    expect(mocks.currentTicket).toHaveBeenCalledWith(tenant.weddingId);
    expect(mocks.submitStep.mock.calls[0][0]).toMatchObject({
      mode: "listed",
      ticket: "c".repeat(64),
      origin: tenant.origin,
    });

    await submitAction(form({ mode: "unlisted" }));
    expect(mocks.submitStep.mock.calls[1][0]).toMatchObject({ mode: "unlisted", ticket: null });

    // cokoli jiného než "unlisted" je odpověď domácnosti
    await submitAction(form({ mode: "admin" }));
    expect(mocks.submitStep.mock.calls[2][0].mode).toBe("listed");
  });

  it("odložené úlohy (e-mail, analytika) jdou přes after() a běží po odpovědi", async () => {
    mocks.submitStep.mockImplementation(
      async (input: { defer: (task: () => Promise<void>) => void }) => {
        input.defer(async () => undefined);
        return { state: { stage: "form" } };
      },
    );
    await submitAction(form({ mode: "listed" }));
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("neočekávaná chyba se vrací jako obecný stav a nikdy s textem výjimky (mohl by nést jména)", async () => {
    mocks.matchStep.mockRejectedValue(new Error("Jan Novák nenalezen v Novákovi"));
    expect(await matchAction(form({ name: "Jan Novák" }))).toEqual({
      stage: "name",
      error: "generic",
    });
    mocks.submitStep.mockRejectedValue(new Error("tajné jméno Karel"));
    expect(await submitAction(form({ mode: "listed" }))).toEqual({
      stage: "form",
      error: "generic",
    });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toMatch(/Jan Novák|Karel/);
  });

  it("zamčený web bez relace hosta RSVP neobslouží (akce jde poslat i mimo stránku)", async () => {
    mocks.getSiteState.mockResolvedValue({ kind: "locked" });
    expect(await matchAction(form({ name: "Jan Novák" }))).toEqual({
      stage: "name",
      error: "generic",
    });
    expect(await unlistedAction(form({}))).toEqual({ stage: "name", error: "generic" });
    await submitAction(form({ mode: "listed" }));
    expect(mocks.matchStep).not.toHaveBeenCalled();
    expect(mocks.unlistedStep).not.toHaveBeenCalled();
    expect(mocks.submitStep).not.toHaveBeenCalled();
  });

  it('"Zadat jiné jméno" smaže lístek i kód osobního odkazu', async () => {
    expect(await resetAction(form({}))).toEqual({ stage: "name" });
    expect(mocks.clearTicket).toHaveBeenCalledTimes(1);
    expect(mocks.clearInvite).toHaveBeenCalledTimes(1);
  });
});

describe("Server Action webu páru: PIN hostů", () => {
  const pin = (value: string) => form({ pin: value, locale: "cs" });

  it("špatný tvar PINu se odmítne bez dotazu na databázi a bez započtení chyby", async () => {
    for (const value of ["", "123", "abcdef", "1234567890123", "12 34"]) {
      expect(await unlockAction(null, pin(value))).toEqual({ error: "format" });
    }
    expect(mocks.unlockWithGuestPin).not.toHaveBeenCalled();
  });

  it("PIN se zadaný s mezerami a spojovníky očistí", async () => {
    mocks.unlockWithGuestPin.mockResolvedValue({ status: "invalid" });
    await unlockAction(null, pin("482 915"));
    await unlockAction(null, pin("482-915"));
    expect(mocks.unlockWithGuestPin.mock.calls.map((c) => c[0].pin)).toEqual(["482915", "482915"]);
    expect(mocks.unlockWithGuestPin.mock.calls[0][0]).toMatchObject({
      weddingId: tenant.weddingId,
      slug: tenant.slug,
      ip: "198.51.100.7",
    });
  });

  it("správný PIN nastaví cookie hosta a ohlásí odemčení; chyby se mapují bez prozrazení", async () => {
    mocks.unlockWithGuestPin.mockResolvedValue({ status: "ok", token: "tok", sessionId: "s" });
    expect(await unlockAction(null, pin("482915"))).toEqual({ unlocked: true });
    expect(mocks.setGuestCookie).toHaveBeenCalledWith("tok");

    mocks.setGuestCookie.mockClear();
    mocks.unlockWithGuestPin.mockResolvedValue({ status: "invalid" });
    expect(await unlockAction(null, pin("135790"))).toEqual({ error: "invalid" });
    mocks.unlockWithGuestPin.mockResolvedValue({ status: "limited", retryAfter: 100 });
    expect(await unlockAction(null, pin("135790"))).toEqual({ error: "limited" });
    mocks.unlockWithGuestPin.mockResolvedValue({ status: "locked", retryAfter: 900 });
    expect(await unlockAction(null, pin("135790"))).toEqual({
      error: "locked",
      pause: "15\u00a0minut",
    });
    expect(mocks.setGuestCookie).not.toHaveBeenCalled();
  });

  it("výpadek databáze nebo čítačů: PIN selže zavřeně, cookie se nenastaví", async () => {
    mocks.unlockWithGuestPin.mockRejectedValue(new Error("databáze nejede"));
    expect(await unlockAction(null, pin("482915"))).toEqual({ error: "generic" });
    expect(mocks.setGuestCookie).not.toHaveBeenCalled();
  });

  it("jiný hostitel než web páru PIN nepřijme", async () => {
    mocks.tenantFromRequest.mockResolvedValue(null);
    expect(await unlockAction(null, pin("482915"))).toEqual({ error: "generic" });
    expect(mocks.unlockWithGuestPin).not.toHaveBeenCalled();
  });
});
