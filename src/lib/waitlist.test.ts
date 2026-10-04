import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HONEYPOT_FIELD,
  WAITLIST_CONSENT_VERSION,
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
  it("ochrana před roboty až po kontrole vstupu: chybné pole token nespotřebuje, robot se nezapíše", async () => {
    const { value, added } = deps();
    const verifyHuman = vi.fn(async () => false);
    expect(
      await submitWaitlist({ ...valid, consent: false }, { ...value, verifyHuman }),
    ).toMatchObject({
      status: "invalid",
    });
    expect(verifyHuman).not.toHaveBeenCalled();
    expect(await submitWaitlist(valid, { ...value, verifyHuman })).toEqual({ status: "bot" });
    expect(added).toEqual([]);
  });

  it("platný vstup uloží normalizovaný záznam s časem souhlasu", async () => {
    const { value, added } = deps();
    expect(await submitWaitlist(valid, value)).toEqual({ status: "success" });
    expect(added).toEqual([
      {
        email: "klara@example.com",
        locale: "cs",
        consentAt: new Date("2026-10-02T10:00:00Z"),
        consentTextVersion: WAITLIST_CONSENT_VERSION,
      },
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

describe("selhání omezení počtu požadavků", () => {
  it("zavře se (chyba), nic se neuloží a IP se nelogují", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const limiter: RateLimiter = {
      check: vi.fn(async () => {
        throw new Error("spojení selhalo pro 203.0.113.7");
      }),
    };
    const { value, added } = deps({ rateLimiter: limiter });
    const result = await submitWaitlist({ ...valid, clientKey: "203.0.113.7" }, value);
    expect(result).toEqual({ status: "error" });
    expect(added).toEqual([]);
    expect(JSON.stringify(error.mock.calls)).not.toContain("203.0.113.7");
  });
});

describe("opakovaný e-mail", () => {
  it("stejný e-mail podruhé dá stejnou odpověď (žádné prozrazení)", async () => {
    let created = true;
    const store: WaitlistStore = {
      async add() {
        const result = { created };
        created = false;
        return result;
      },
    };
    const value = deps({ store }).value;
    const first = await submitWaitlist(valid, value);
    const second = await submitWaitlist({ ...valid, email: "KLARA@example.com" }, value);
    expect(second).toEqual(first);
    expect(second).toEqual({ status: "success" });
  });
});
