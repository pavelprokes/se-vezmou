import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HONEYPOT_FIELD,
  logOnlyWaitlistStore,
  submitWaitlist,
  waitlistSchema,
  type RateLimiter,
  type WaitlistDeps,
  type WaitlistEntry,
  type WaitlistStore,
} from "./waitlist";

function deps(overrides: Partial<WaitlistDeps> = {}) {
  const added: WaitlistEntry[] = [];
  const store: WaitlistStore = {
    async add(entry) {
      added.push(entry);
      return { created: true };
    },
  };
  const limiter: RateLimiter = { check: vi.fn(async () => ({ allowed: true })) };
  const value: WaitlistDeps = {
    store,
    rateLimiter: limiter,
    now: () => new Date("2026-10-02T10:00:00Z"),
    ...overrides,
  };
  return { value, added, limiter };
}

const valid = { email: "  Klara@Example.COM ", consent: "on", locale: "cs" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("waitlistSchema", () => {
  it("ořízne a převede e-mail na malá písmena", () => {
    const parsed = waitlistSchema.safeParse({
      email: " Par@Example.com ",
      consent: true,
      locale: "en",
    });
    expect(parsed.success && parsed.data).toEqual({
      email: "par@example.com",
      consent: true,
      locale: "en",
    });
  });

  it("neznámý jazyk spadne na češtinu", () => {
    const parsed = waitlistSchema.safeParse({ email: "a@b.cz", consent: true, locale: "de" });
    expect(parsed.success && parsed.data.locale).toBe("cs");
  });

  it.each(["", "bez-zavinace", "a@b", "a b@c.cz", "@c.cz"])("odmítne e-mail %j", (email) => {
    expect(waitlistSchema.safeParse({ email, consent: true, locale: "cs" }).success).toBe(false);
  });

  it("odmítne příliš dlouhý e-mail", () => {
    const email = `${"a".repeat(250)}@b.cz`;
    expect(waitlistSchema.safeParse({ email, consent: true, locale: "cs" }).success).toBe(false);
  });

  it("souhlas musí být výslovně zaškrtnutý", () => {
    expect(
      waitlistSchema.safeParse({ email: "a@b.cz", consent: false, locale: "cs" }).success,
    ).toBe(false);
  });
});

describe("submitWaitlist", () => {
  it("platný vstup uloží normalizovaný záznam s časem souhlasu", async () => {
    const { value, added } = deps();
    expect(await submitWaitlist(valid, value)).toEqual({ status: "success" });
    expect(added).toEqual([
      { email: "klara@example.com", locale: "cs", consentAt: new Date("2026-10-02T10:00:00Z") },
    ]);
  });

  it("chyby vrací po polích jako kódy, nic neukládá", async () => {
    const { value, added } = deps();
    expect(await submitWaitlist({ email: "", consent: undefined, locale: "cs" }, value)).toEqual({
      status: "invalid",
      errors: { email: "required", consent: "required" },
    });
    expect(await submitWaitlist({ email: "neni", consent: "on" }, value)).toEqual({
      status: "invalid",
      errors: { email: "invalid" },
    });
    expect(added).toEqual([]);
  });

  it("vyplněná past na roboty se tváří jako úspěch, ale nic neukládá", async () => {
    const { value, added, limiter } = deps();
    expect(HONEYPOT_FIELD).toBe("website");
    const result = await submitWaitlist({ ...valid, honeypot: "https://spam.example" }, value);
    expect(result).toEqual({ status: "success" });
    expect(added).toEqual([]);
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it("prázdná past (mezery) nevadí", async () => {
    const { value, added } = deps();
    expect(await submitWaitlist({ ...valid, honeypot: "  " }, value)).toEqual({
      status: "success",
    });
    expect(added).toHaveLength(1);
  });

  it("hák pro omezení počtu požadavků dostane klíč a může odeslání zastavit", async () => {
    const limiter: RateLimiter = { check: vi.fn(async () => ({ allowed: false })) };
    const { value, added } = deps({ rateLimiter: limiter });
    const result = await submitWaitlist({ ...valid, clientKey: "203.0.113.7" }, value);
    expect(result).toEqual({ status: "rateLimited" });
    expect(limiter.check).toHaveBeenCalledWith("waitlist:203.0.113.7");
    expect(added).toEqual([]);
  });

  it("bez klíče se omezení nevolá (např. chybí hlavičky proxy)", async () => {
    const { value, limiter } = deps();
    await submitWaitlist(valid, value);
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it("selhání úložiště vrací chybu a nelogují se osobní údaje", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store: WaitlistStore = {
      async add() {
        throw new Error("duplicate key klara@example.com");
      },
    };
    const result = await submitWaitlist(valid, deps({ store }).value);
    expect(result).toEqual({ status: "error" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("klara@example.com");
  });
});

describe("logOnlyWaitlistStore (zástupný adaptér do M3)", () => {
  it("jen zaloguje záznam bez e-mailu a hlásí úspěch", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await logOnlyWaitlistStore.add({
      email: "klara@example.com",
      locale: "en",
      consentAt: new Date(),
    });
    expect(result).toEqual({ created: true });
    expect(info).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain("klara");
    expect(logged).not.toContain("@");
    expect(logged).toContain("en");
  });
});
