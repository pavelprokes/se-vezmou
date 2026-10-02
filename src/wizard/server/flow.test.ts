import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET = "auth-secret-auth-secret-auth-secret-1";
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
  process.env.PIN_PEPPER = "pepper-pepper-pepper-pepper-pepper-0001";
});

const mail = vi.hoisted(() => ({ sent: [] as { to: string; type: string; text: string }[] }));
vi.mock("@/lib/email/send", () => ({
  sendTemplatedEmail: async (input: { to: string; type: string; email: { text: string } }) => {
    mail.sent.push({ to: input.to, type: input.type, text: input.email.text });
    return true;
  },
}));

import { setTransport } from "@/lib/db/rpc";
import { createDraft, type WizardDraft } from "../draft";
import { publicContentSchema } from "@/site/types";
import {
  checkSlugAvailability,
  firstSave,
  openPending,
  openVerified,
  publish,
  renewPreviewToken,
  requestWizardCode,
  sealPending,
  sealVerified,
  trackFromBrowser,
  updateSave,
  verifyWizardCode,
} from "./flow";

type Call = { fn: string; args: Record<string, unknown> };

const WEDDING = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";

interface Behaviour {
  rateAllowed: (key: string) => boolean;
  verify: boolean;
  create: { ok: boolean; variants?: string[] };
  save: { slug: string | null; slug_status: string; variants?: string[] };
  status: string;
  slugCheck: { available: boolean | null; reason: string; retry_after: number };
  otherPinHash: string | null;
}

function fakeDb(overrides: Partial<Behaviour> = {}) {
  const behaviour: Behaviour = {
    rateAllowed: () => true,
    verify: true,
    create: { ok: true },
    save: { slug: "klara-a-matej", slug_status: "ok" },
    status: "draft",
    slugCheck: { available: true, reason: "ok", retry_after: 0 },
    otherPinHash: null,
    ...overrides,
  };
  const calls: Call[] = [];
  setTransport({
    async call(fn, args) {
      calls.push({ fn, args });
      switch (fn) {
        case "rate_limit_hit": {
          const allowed = behaviour.rateAllowed(String(args.p_bucket_key));
          return [{ allowed, retry_after: allowed ? 0 : 42 }];
        }
        case "auth_create_challenge":
          return "challenge-id";
        case "auth_verify_challenge":
          return behaviour.verify;
        case "wizard_create_draft":
          return [
            {
              ok: behaviour.create.ok,
              wedding_id: behaviour.create.ok ? WEDDING : null,
              admin_id: behaviour.create.ok ? ADMIN : null,
              variants: behaviour.create.variants ?? [],
            },
          ];
        case "set_preview_token":
          return null;
        case "wizard_save":
          return [
            {
              variants: [],
              reserved_until: "2026-11-01T10:00:00.000Z",
              ...behaviour.save,
            },
          ];
        case "wizard_load":
          return [
            {
              status: behaviour.status,
              slug: "klara-a-matej",
              reserved_until: null,
              draft: {},
              preview_enabled: true,
            },
          ];
        case "publish_site":
          return [{ version_no: 1, slug: String(args.p_wedding_id).length ? "klara-a-matej" : "" }];
        case "auth_pin_other_hash":
          return behaviour.otherPinHash;
        case "auth_pin_set":
          return "zaloha@example.test";
        case "analytics_record":
          return null;
        case "check_slug":
          return [behaviour.slugCheck];
        default:
          throw new Error(`neočekávaná funkce ${fn}`);
      }
    },
  });
  return { calls, behaviour };
}

const names = (calls: Call[]) => calls.map((call) => call.fn);

function draft(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return {
    ...createDraft({ locale: "cs", partnerA: "Klára", partnerB: "Matěj" }),
    startsOn: "2027-06-19",
    ...overrides,
  };
}

beforeEach(() => {
  mail.sent.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setTransport(null);
});

describe("requestWizardCode", () => {
  it("pošle šestimístný kód na e-mail a založí výzvu s účelem wizard_create", async () => {
    const db = fakeDb();
    const tasks: (() => Promise<unknown>)[] = [];
    const result = await requestWizardCode({
      email: "klara@example.test",
      ip: "203.0.113.7",
      locale: "cs",
      defer: (task) => tasks.push(task),
    });
    expect(result).toEqual({ status: "sent" });
    const challenge = db.calls.find((call) => call.fn === "auth_create_challenge");
    expect(challenge?.args).toMatchObject({ p_purpose: "wizard_create", p_ttl_seconds: 600 });
    expect(challenge?.args.p_email_hash).toBeInstanceOf(Buffer);

    await Promise.all(tasks.map((task) => task()));
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: "klara@example.test", type: "login_code" });
    expect(mail.sent[0].text).toMatch(/^\d{6}$/m);
  });

  it("v databázi není ani e-mail, ani IP v čitelném tvaru", async () => {
    const db = fakeDb();
    await requestWizardCode({
      email: "klara@example.test",
      ip: "203.0.113.7",
      locale: "en",
      defer: () => {},
    });
    const serialized = JSON.stringify(db.calls);
    expect(serialized).not.toContain("klara@example.test");
    expect(serialized).not.toContain("203.0.113.7");
  });

  it("limit podle IP: žádná výzva ani e-mail", async () => {
    const db = fakeDb({ rateAllowed: (key) => !key.startsWith("wizard-code-ip:") });
    const tasks: (() => Promise<unknown>)[] = [];
    const result = await requestWizardCode({
      email: "klara@example.test",
      ip: "203.0.113.7",
      locale: "cs",
      defer: (task) => tasks.push(task),
    });
    expect(result).toEqual({ status: "limited", retryAfter: 42 });
    expect(names(db.calls)).not.toContain("auth_create_challenge");
    expect(tasks).toHaveLength(0);
  });

  it("limit podle e-mailu: stejná odpověď jako při úspěchu, ale kód se nepošle", async () => {
    const db = fakeDb({ rateAllowed: (key) => !key.startsWith("wizard-code-email:") });
    const tasks: (() => Promise<unknown>)[] = [];
    const result = await requestWizardCode({
      email: "klara@example.test",
      ip: "203.0.113.7",
      locale: "cs",
      defer: (task) => tasks.push(task),
    });
    expect(result).toEqual({ status: "sent" });
    expect(names(db.calls)).not.toContain("auth_create_challenge");
    expect(tasks).toHaveLength(0);
  });
});

describe("verifyWizardCode", () => {
  it("správný kód, špatný kód a limit", async () => {
    fakeDb({ verify: true });
    expect(await verifyWizardCode({ email: "a@b.cz", code: "123456", ip: "1.1.1.1" })).toBe("ok");
    fakeDb({ verify: false });
    expect(await verifyWizardCode({ email: "a@b.cz", code: "123456", ip: "1.1.1.1" })).toBe(
      "invalid",
    );
    const db = fakeDb({ rateAllowed: () => false });
    expect(await verifyWizardCode({ email: "a@b.cz", code: "123456", ip: "1.1.1.1" })).toEqual({
      limited: 42,
    });
    expect(names(db.calls)).not.toContain("auth_verify_challenge");
  });

  it("ověřuje s účelem wizard_create a kód svázaný s e-mailem", async () => {
    const db = fakeDb();
    await verifyWizardCode({ email: "a@b.cz", code: "123456", ip: "1.1.1.1" });
    const call = db.calls.find((c) => c.fn === "auth_verify_challenge");
    expect(call?.args).toMatchObject({ p_purpose: "wizard_create", p_max_attempts: 5 });
  });
});

describe("zapečetěný stav (cookie)", () => {
  const emails = { email: "klara@example.test", backupEmail: "zaloha@example.test" };

  it("rozpracované i ověřené e-maily se otevřou, ale nejsou čitelné", () => {
    const pending = sealPending(emails);
    expect(pending).not.toContain("klara");
    expect(openPending(pending)).toEqual(emails);
    expect(openVerified(sealVerified(emails))).toEqual(emails);
  });

  it("rozpracovaný stav nejde vydávat za ověřený a naopak", () => {
    expect(openVerified(sealPending(emails))).toBeNull();
    expect(openPending(sealVerified(emails))).toBeNull();
  });

  it("platnost: kód 10 minut, ověřený e-mail 30 minut", () => {
    const now = Date.now();
    expect(openPending(sealPending(emails, now), now + 9 * 60_000)).toEqual(emails);
    expect(openPending(sealPending(emails, now), now + 11 * 60_000)).toBeNull();
    expect(openVerified(sealVerified(emails, now), now + 29 * 60_000)).toEqual(emails);
    expect(openVerified(sealVerified(emails, now), now + 31 * 60_000)).toBeNull();
  });

  it("podvržený nebo poškozený token je null", () => {
    expect(openVerified("nesmysl")).toBeNull();
    expect(openVerified(sealVerified(emails).slice(0, -3) + "abc")).toBeNull();
  });
});

describe("firstSave", () => {
  const emails = { email: "klara@example.test", backupEmail: "zaloha@example.test" };

  it("neúplný koncept se neukládá a nic se nevolá", async () => {
    const db = fakeDb();
    const result = await firstSave({ emails, draft: draft({ startsOn: "" }), ip: "1.1.1.1" });
    expect(result.status).toBe("incomplete");
    expect(db.calls).toEqual([]);
  });

  it("založí svatbu jednou transakcí, bez PINu v prostém tvaru, a vydá odkaz na náhled", async () => {
    const db = fakeDb();
    const result = await firstSave({
      emails,
      draft: draft({ guestPin: { enabled: true, pin: "482915" } }),
      ip: "1.1.1.1",
    });
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.weddingId).toBe(WEDDING);
    expect(result.previewToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(names(db.calls)).toEqual(["rate_limit_hit", "wizard_create_draft", "set_preview_token"]);
    const create = db.calls.find((c) => c.fn === "wizard_create_draft")!;
    expect(create.args).toMatchObject({
      p_email: "klara@example.test",
      p_backup_email: "zaloha@example.test",
      p_slug: "klara-a-matej",
    });
    expect(JSON.stringify(db.calls)).not.toContain("482915");

    const preview = db.calls.find((c) => c.fn === "set_preview_token")!;
    const hash = preview.args.p_token_hash as Buffer;
    expect(hash).toBeInstanceOf(Buffer);
    expect(hash.length).toBe(32);
    // v databázi je jen hash, ne token
    expect(JSON.stringify(db.calls)).not.toContain(result.previewToken);
  });

  it("kolize adresy: nic se nezaloží, žádný odkaz na náhled, vrátí varianty", async () => {
    const db = fakeDb({
      create: { ok: false, variants: ["klara-a-matej-2027", "klara-a-matej-obec"] },
    });
    const result = await firstSave({ emails, draft: draft(), ip: "1.1.1.1" });
    expect(result).toEqual({
      status: "taken",
      variants: ["klara-a-matej-2027", "klara-a-matej-obec"],
    });
    expect(names(db.calls)).not.toContain("set_preview_token");
  });

  it("limit vytváření podle IP", async () => {
    const db = fakeDb({ rateAllowed: () => false });
    expect(await firstSave({ emails, draft: draft(), ip: "1.1.1.1" })).toEqual({
      status: "limited",
      retryAfter: 42,
    });
    expect(names(db.calls)).not.toContain("wizard_create_draft");
  });
});

describe("updateSave", () => {
  it("uloží koncept svatby a vrátí stav adresy", async () => {
    const db = fakeDb({ save: { slug: "klara-a-matej", slug_status: "ok" } });
    const result = await updateSave({ weddingId: WEDDING, draft: draft() });
    expect(result).toEqual({
      status: "saved",
      slug: "klara-a-matej",
      slugStatus: "ok",
      variants: [],
      reservedUntil: "2026-11-01T10:00:00.000Z",
    });
    const save = db.calls.find((c) => c.fn === "wizard_save")!;
    expect(save.args).toMatchObject({ p_wedding_id: WEDDING, p_slug: "klara-a-matej" });
  });

  it("kolize adresy při ukládání: data se uloží a pár dostane varianty", async () => {
    fakeDb({ save: { slug: null, slug_status: "taken", variants: ["klara-a-matej-obec"] } });
    const result = await updateSave({ weddingId: WEDDING, draft: draft() });
    expect(result).toMatchObject({
      status: "saved",
      slug: null,
      slugStatus: "taken",
      variants: ["klara-a-matej-obec"],
    });
  });

  it("zveřejněný web průvodce neukládá", async () => {
    const db = fakeDb({ status: "published" });
    expect(await updateSave({ weddingId: WEDDING, draft: draft() })).toEqual({
      status: "not_draft",
    });
    expect(names(db.calls)).not.toContain("wizard_save");
  });

  it("neúplný koncept a limit se neukládají", async () => {
    const db = fakeDb();
    expect((await updateSave({ weddingId: WEDDING, draft: draft({ partnerA: "" }) })).status).toBe(
      "incomplete",
    );
    expect(db.calls).toEqual([]);
    fakeDb({ rateAllowed: () => false });
    expect((await updateSave({ weddingId: WEDDING, draft: draft() })).status).toBe("limited");
  });
});

describe("renewPreviewToken", () => {
  it("vydá nový token a uloží jen jeho hash", async () => {
    const db = fakeDb();
    const token = await renewPreviewToken({ weddingId: WEDDING, adminId: ADMIN });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(db.calls).toHaveLength(1);
    expect(JSON.stringify(db.calls)).not.toContain(token);
  });
});

describe("publish", () => {
  it("nevalidní koncept se nezveřejní a nic se neukládá", async () => {
    const db = fakeDb();
    const result = await publish({
      weddingId: WEDDING,
      adminId: ADMIN,
      draft: draft({ ceremony: { ...draft().ceremony, enabled: true, time: "" } }),
    });
    expect(result.status).toBe("invalid");
    expect(db.calls).toEqual([]);
  });

  it("úspěch: uloží, vloží verzi s platným snímkem a změří událost", async () => {
    const db = fakeDb();
    const result = await publish({ weddingId: WEDDING, adminId: ADMIN, draft: draft() });
    expect(result).toEqual({ status: "published", slug: "klara-a-matej", versionNo: 1 });
    expect(names(db.calls)).toEqual([
      "rate_limit_hit",
      "wizard_load",
      "wizard_save",
      "publish_site",
      "analytics_record",
    ]);
    const call = db.calls.find((c) => c.fn === "publish_site")!;
    expect(call.args).toMatchObject({ p_wedding_id: WEDDING, p_actor_admin_id: ADMIN });
    expect(publicContentSchema.safeParse(call.args.p_public_content).success).toBe(true);
    expect((call.args.p_public_content as { slug: string }).slug).toBe("klara-a-matej");
    expect(call.args.p_sensitive).toEqual({ venues: {}, gifts: null, gallery: null });

    const event = db.calls.find((c) => c.fn === "analytics_record")!;
    expect(event.args).toEqual({
      p_event: "site_published",
      p_locale: "cs",
      p_template: "eukalyptus",
      p_step: null,
    });
  });

  it("PIN hostů: uloží se jen hash před zveřejněním, v databázi není prostý PIN", async () => {
    const db = fakeDb();
    const result = await publish({
      weddingId: WEDDING,
      adminId: ADMIN,
      draft: draft({ guestPin: { enabled: true, pin: "482915" } }),
    });
    expect(result.status).toBe("published");
    const order = names(db.calls);
    expect(order.indexOf("auth_pin_set")).toBeGreaterThan(order.indexOf("wizard_save"));
    expect(order.indexOf("auth_pin_set")).toBeLessThan(order.indexOf("publish_site"));
    const pin = db.calls.find((c) => c.fn === "auth_pin_set")!;
    expect(pin.args).toMatchObject({ p_wedding_id: WEDDING, p_role: "guest" });
    expect(String(pin.args.p_hash)).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(db.calls)).not.toContain("482915");
  });

  it("triviální PIN zveřejnění zastaví", async () => {
    const db = fakeDb();
    const result = await publish({
      weddingId: WEDDING,
      adminId: ADMIN,
      draft: draft({ guestPin: { enabled: true, pin: "111111" } }),
    });
    expect(result.status).toBe("invalid");
    expect(names(db.calls)).not.toContain("publish_site");
  });

  it("adresa mezitím zabraná: nezveřejní se a vrátí varianty", async () => {
    const db = fakeDb({
      save: { slug: null, slug_status: "taken", variants: ["klara-a-matej-2027"] },
    });
    const result = await publish({ weddingId: WEDDING, adminId: ADMIN, draft: draft() });
    expect(result).toEqual({
      status: "slug_unavailable",
      variants: ["klara-a-matej-2027"],
      slugStatus: "taken",
    });
    expect(names(db.calls)).not.toContain("publish_site");
  });

  it("už zveřejněný web: not_draft", async () => {
    const db = fakeDb({ status: "published" });
    expect(await publish({ weddingId: WEDDING, adminId: ADMIN, draft: draft() })).toEqual({
      status: "not_draft",
    });
    expect(names(db.calls)).not.toContain("publish_site");
  });
});

describe("checkSlugAvailability", () => {
  it("normalizuje vstup a ptá se databáze s omezením podle IP (klíč je HMAC)", async () => {
    const db = fakeDb();
    const result = await checkSlugAvailability("Klára a Matěj.se-vezmou.cz", "203.0.113.7");
    expect(result).toEqual({ status: "available", slug: "klara-a-matej" });
    const call = db.calls[0];
    expect(call.fn).toBe("check_slug");
    expect(call.args.p_slug).toBe("klara-a-matej");
    expect(String(call.args.p_rate_key)).toMatch(/^slug-check-ip:/);
    expect(String(call.args.p_rate_key)).not.toContain("203.0.113.7");
  });

  it("zabraná, rezervovaná i blokovaná adresa mají stejnou odpověď", async () => {
    const taken = fakeDb({
      slugCheck: { available: false, reason: "unavailable", retry_after: 0 },
    });
    const a = await checkSlugAvailability("obsazena-adresa", "1.1.1.1");
    expect(taken.calls).toHaveLength(1);
    const noDb = fakeDb();
    const b = await checkSlugAvailability("admin", "1.1.1.1");
    const c = await checkSlugAvailability("kurva-a-matej", "1.1.1.1");
    expect(noDb.calls).toHaveLength(0); // rezervované a blokované se rozpoznají bez databáze
    expect(a.status).toBe("unavailable");
    expect(b.status).toBe("unavailable");
    expect(c.status).toBe("unavailable");
    expect({ ...a, slug: "" }).toEqual({ ...b, slug: "" });
  });

  it("neplatný tvar se do databáze neposílá", async () => {
    const db = fakeDb();
    expect(await checkSlugAvailability("", "1.1.1.1")).toMatchObject({
      status: "invalid",
      problem: "empty",
    });
    expect(await checkSlugAvailability("ab", "1.1.1.1")).toMatchObject({
      status: "invalid",
      problem: "too_short",
    });
    expect(db.calls).toHaveLength(0);
  });

  it("po překročení limitu dostupnost neprozradí", async () => {
    fakeDb({ slugCheck: { available: null, reason: "rate_limited", retry_after: 30 } });
    expect(await checkSlugAvailability("klara-a-matej", "1.1.1.1")).toEqual({
      status: "limited",
      retryAfter: 30,
    });
  });
});

describe("trackFromBrowser", () => {
  it("zapíše událost jen s jazykem, šablonou a krokem", async () => {
    const db = fakeDb();
    await trackFromBrowser({
      event: "wizard_step_completed",
      locale: "en",
      template: "chateau",
      step: 3,
      ip: "203.0.113.7",
    });
    const event = db.calls.find((c) => c.fn === "analytics_record")!;
    expect(event.args).toEqual({
      p_event: "wizard_step_completed",
      p_locale: "en",
      p_template: "chateau",
      p_step: 3,
    });
    expect(JSON.stringify(db.calls)).not.toContain("203.0.113.7");
  });

  it("po překročení limitu událost tiše zahodí", async () => {
    const db = fakeDb({ rateAllowed: () => false });
    await trackFromBrowser({
      event: "wizard_started",
      locale: "cs",
      template: null,
      step: null,
      ip: "1.1.1.1",
    });
    expect(names(db.calls)).not.toContain("analytics_record");
  });

  it("selhání zápisu měření nevyhodí výjimku ani nezaloguje data", async () => {
    setTransport({
      async call(fn) {
        if (fn === "rate_limit_hit") return [{ allowed: true, retry_after: 0 }];
        throw new Error("spadlo to");
      },
    });
    await expect(
      trackFromBrowser({
        event: "wizard_started",
        locale: "cs",
        template: null,
        step: null,
        ip: "1.1.1.1",
      }),
    ).resolves.toBeUndefined();
  });
});
