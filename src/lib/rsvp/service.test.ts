import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET = "auth-secret-auth-secret-auth-secret-1";
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
});

vi.mock("@/lib/email/transport", () => ({
  sendEmail: vi.fn(async () => ({ providerMessageId: "msg-1" })),
}));

import { sendEmail } from "@/lib/email/transport";
import { setTransport } from "@/lib/db/rpc";
import { DbError, type RpcTransport, type TenantIdentity } from "@/lib/db/transport";
import { initialState, matchStep, submitStep, unlistedStep } from "./service";
import {
  E_HOSTINA,
  E_OBRAD,
  formOf,
  G_ANEZKA,
  G_JAN,
  G_MARIE,
  householdView,
  unlistedView,
  WEDDING,
} from "./test-fixtures";

type Call = { fn: string; args: Record<string, unknown>; as?: TenantIdentity };
type Handler = (args: Record<string, unknown>) => unknown;

function fakeDb(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const transport: RpcTransport = {
    async call(fn, args, _kind, as) {
      calls.push({ fn, args, as });
      const handler = handlers[fn];
      if (!handler) throw new Error(`Neočekávané volání ${fn}`);
      return handler(args);
    },
  };
  setTransport(transport);
  return {
    calls,
    names: () => calls.map((c) => c.fn),
    of: (fn: string) => calls.filter((c) => c.fn === fn),
  };
}

const allow: Handler = () => [{ allowed: true, retry_after: 0 }];
const deny: Handler = () => [{ allowed: false, retry_after: 600 }];
const TICKET = "a".repeat(64);
const base = {
  email_log_insert: () => "55555555-5555-4555-8555-555555555555",
  email_log_set_status: () => true,
  analytics_record: () => null,
  auth_session_context: () => [
    {
      slug: "klara-a-matej",
      status: "published",
      partner_a_name: "Klára",
      partner_b_name: "Matěj",
    },
  ],
};

function deferred() {
  const tasks: (() => Promise<unknown>)[] = [];
  return {
    defer: (task: () => Promise<unknown>) => void tasks.push(task),
    run: async () => {
      for (const task of tasks.splice(0)) await task();
    },
    count: () => tasks.length,
  };
}

const complete: [string, string][] = [
  [`g.${G_JAN}.ev.${E_OBRAD}`, "yes"],
  [`g.${G_JAN}.ev.${E_HOSTINA}`, "yes"],
  [`g.${G_MARIE}.ev.${E_OBRAD}`, "yes"],
  [`g.${G_MARIE}.ev.${E_HOSTINA}`, "no"],
  [`g.${G_ANEZKA}.ev.${E_OBRAD}`, "yes"],
];

const submitInput = (overrides = {}) => ({
  weddingId: WEDDING,
  slug: "klara-a-matej",
  ip: "198.51.100.7",
  mode: "listed" as const,
  ticket: TICKET as string | null,
  form: formOf(complete),
  locale: "cs" as const,
  origin: "https://klara-a-matej.se-vezmou.cz",
  defer: () => undefined,
  ...overrides,
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  setTransport(null);
  vi.mocked(sendEmail).mockClear();
});

describe("matchStep: slepé ověření jména (FR-RSVP-1)", () => {
  const input = {
    weddingId: WEDDING,
    slug: "klara-a-matej",
    ip: "198.51.100.7",
    locale: "cs" as const,
    honeypot: "",
  };

  it("prázdné jméno se nehledá a hlásí se u pole", async () => {
    const db = fakeDb({ rate_limit_hit: allow });
    const result = await matchStep({ ...input, name: "   " });
    expect(result.state).toEqual({ stage: "name", error: "name_required", value: "" });
    expect(db.calls).toHaveLength(0);
  });

  it("shoda vydá lístek a model domácnosti; volání jde jako návštěvník své svatby", async () => {
    const db = fakeDb({
      rate_limit_hit: allow,
      rsvp_match: () => [{ ticket: TICKET }],
      rsvp_get: () => householdView(),
    });
    const result = await matchStep({ ...input, name: "  jan novak " });
    expect(result.ticket).toEqual({ set: TICKET });
    expect(result.state.stage).toBe("form");
    expect(result.state.model?.guests.map((g) => g.name)).toEqual([
      "Jan Novák",
      "Marie Nováková",
      "Anežka Nováková",
    ]);
    const match = db.of("rsvp_match")[0];
    expect(match.args).toEqual({ p_name: "jan novak" });
    expect(match.as).toEqual({ weddingId: WEDDING, weddingRole: "visitor" });
    expect(db.of("rsvp_get")[0].args).toEqual({ p_ticket: TICKET });
    // klíč omezení je HMAC: ani adresa webu, ani IP nejsou v databázi čitelné
    const key = String(db.of("rate_limit_hit")[0].args.p_bucket_key);
    expect(key).toMatch(/^rsvp-match:[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(db.calls)).not.toContain("198.51.100.7");
    expect(JSON.stringify(db.calls)).not.toContain("klara-a-matej");
  });

  it("neshoda, více shod, skrytá past, překročený limit i nesmyslná délka dávají stejný stav", async () => {
    const outcomes: unknown[] = [];

    fakeDb({ rate_limit_hit: allow, rsvp_match: () => [{ ticket: null }] });
    outcomes.push((await matchStep({ ...input, name: "Karel Nikdo" })).state);

    // více shod i zavřené RSVP: databáze vrací totéž, ticket je null
    fakeDb({ rate_limit_hit: allow, rsvp_match: () => [{ ticket: null }] });
    outcomes.push((await matchStep({ ...input, name: "Karel Nikdo" })).state);

    // robot (vyplněná past) se nikdy nedostane k databázi s jménem
    const bot = fakeDb({ rate_limit_hit: allow });
    outcomes.push(
      (await matchStep({ ...input, name: "Karel Nikdo", honeypot: "http://spam" })).state,
    );
    expect(bot.names()).toEqual(["rate_limit_hit"]);

    // limit podle svatby a IP je vyčerpaný: existující host vypadá jako neexistující
    const limited = fakeDb({ rate_limit_hit: deny, rsvp_match: () => [{ ticket: TICKET }] });
    outcomes.push((await matchStep({ ...input, name: "Karel Nikdo" })).state);
    expect(limited.of("rsvp_match")).toHaveLength(0);

    fakeDb({ rate_limit_hit: allow, rsvp_match: () => [{ ticket: TICKET }] });
    const long = await matchStep({ ...input, name: "x".repeat(201) });
    expect({ ...long.state, value: "Karel Nikdo" }).toEqual(outcomes[0]);

    for (const outcome of outcomes) {
      expect(outcome).toEqual({ stage: "name", error: "not_found", value: "Karel Nikdo" });
    }
  });

  it("lístek bez čitelného pohledu na domácnost se bere jako neshoda", async () => {
    fakeDb({ rate_limit_hit: allow, rsvp_match: () => [{ ticket: TICKET }], rsvp_get: () => null });
    const result = await matchStep({ ...input, name: "Jan Novák" });
    expect(result.state.error).toBe("not_found");
    expect(result.ticket).toBeUndefined();
  });

  it("výpadek čítačů omezení nezablokuje RSVP (selhává otevřeně)", async () => {
    fakeDb({
      rate_limit_hit: () => {
        throw new DbError("rate_limit_hit", "08006", "chyba spojení");
      },
      rsvp_match: () => [{ ticket: TICKET }],
      rsvp_get: () => householdView(),
    });
    const result = await matchStep({ ...input, name: "Jan Novák" });
    expect(result.state.stage).toBe("form");
  });
});

describe("initialState a host mimo seznam", () => {
  it("platný lístek otevře formulář s dřívější odpovědí, prošlý vrátí první krok", async () => {
    fakeDb({ rsvp_get: () => householdView() });
    const open = await initialState({ weddingId: WEDDING, ticket: TICKET, locale: "cs" });
    expect(open.state.stage).toBe("form");
    expect(open.staleTicket).toBe(false);

    fakeDb({ rsvp_get: () => null });
    const stale = await initialState({ weddingId: WEDDING, ticket: TICKET, locale: "cs" });
    expect(stale).toEqual({ state: { stage: "name" }, staleTicket: true });

    const none = fakeDb({});
    expect(await initialState({ weddingId: WEDDING, ticket: null, locale: "cs" })).toEqual({
      state: { stage: "name" },
      staleTicket: false,
    });
    expect(none.calls).toHaveLength(0);
  });

  it("formulář hosta mimo seznam jen když ho pár povolil", async () => {
    fakeDb({ rsvp_unlisted_form: () => unlistedView() });
    const open = await unlistedStep({ weddingId: WEDDING, locale: "cs" });
    expect(open.state.model?.mode).toBe("unlisted");
    expect(open.ticket).toBeUndefined();

    fakeDb({ rsvp_unlisted_form: () => null });
    expect((await unlistedStep({ weddingId: WEDDING, locale: "cs" })).state).toEqual({
      stage: "name",
      error: "generic",
    });
  });
});

describe("submitStep: odeslání a úprava (FR-RSVP-5, FR-RSVP-6)", () => {
  const listedHandlers = (extra: Record<string, Handler> = {}) => ({
    ...base,
    rate_limit_hit: allow,
    rsvp_get: () => householdView(),
    rsvp_submit: () => ({ ok: true, response_id: "r1" }),
    ...extra,
  });

  it("úspěch: zápis s lístkem, souhrn bez zdravotních údajů, analytika bez identifikátorů", async () => {
    const db = fakeDb(listedHandlers());
    const later = deferred();
    const result = await submitStep(
      submitInput({
        form: formOf([...complete, [`g.${G_JAN}.diet`, "bezlepková"]]),
        defer: later.defer,
      }),
    );

    expect(result.state.stage).toBe("form");
    expect(result.state.done).toMatchObject({ emailSent: false, unlisted: false });
    expect(result.state.done?.people).toHaveLength(3);
    expect(JSON.stringify(result.state)).not.toContain("bezlepková");
    expect(result.state.model?.existing).toBe(false);

    const submit = db.of("rsvp_submit")[0];
    expect(submit.args.p_ticket).toBe(TICKET);
    expect(submit.as).toEqual({ weddingId: WEDDING, weddingRole: "visitor" });
    const payload = submit.args.p_payload as { people: { guest_id: string }[] };
    expect(payload.people.map((p) => p.guest_id)).toEqual([G_JAN, G_MARIE, G_ANEZKA]);

    await later.run();
    const analytics = db.of("analytics_record");
    expect(analytics).toHaveLength(1);
    expect(analytics[0].args).toEqual({ p_event: "rsvp_completed", p_locale: "cs" });
    expect(JSON.stringify(analytics[0])).not.toMatch(/klara|198\.51|Jan|Nov|diet/i);
    expect(analytics[0].as).toBeUndefined();
  });

  it("úprava existující odpovědi se do analytiky nepočítá podruhé", async () => {
    const db = fakeDb(
      listedHandlers({
        rsvp_get: () =>
          householdView({
            response: { answers: {}, contact_email: null, entered_by: "guest", people: [] },
          }),
      }),
    );
    const later = deferred();
    await submitStep(submitInput({ defer: later.defer }));
    await later.run();
    expect(db.of("analytics_record")).toHaveLength(0);
    expect(db.of("rsvp_submit")).toHaveLength(1);
  });

  it("potvrzení e-mailem: jen při zapnutém potvrzení, bez zdravotních údajů, záznam bez adresy", async () => {
    const db = fakeDb(listedHandlers());
    const later = deferred();
    const result = await submitStep(
      submitInput({
        form: formOf([
          ...complete,
          ["email", "jan@example.test"],
          [`g.${G_JAN}.diet`, "bezlepková"],
          [`g.${G_JAN}.allergies`, "ořechy"],
        ]),
        defer: later.defer,
      }),
    );
    expect(result.state.done?.emailSent).toBe(true);
    await later.run();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = vi.mocked(sendEmail).mock.calls[0][0];
    expect(message.to).toBe("jan@example.test");
    expect(message.subject).toContain("Klára");
    for (const secret of ["bezlepková", "ořechy"]) {
      expect(message.text).not.toContain(secret);
      expect(message.html).not.toContain(secret);
    }
    expect(message.text).toContain("Jan Novák");
    expect(message.text).toContain("https://klara-a-matej.se-vezmou.cz/#potvrdit-ucast");

    const log = db.of("email_log_insert")[0].args;
    expect(log).toMatchObject({
      p_type: "rsvp_confirmation",
      p_locale: "cs",
      p_recipient_domain: "example.test",
    });
    expect(JSON.stringify(log)).not.toContain("jan@");
    // předávaná HMAC adresy je bytea, ne text adresy
    expect(Buffer.isBuffer(log.p_recipient_hash)).toBe(true);

    // pár potvrzení nezapnul: adresa se ignoruje a nic se neodešle
    vi.mocked(sendEmail).mockClear();
    fakeDb(
      listedHandlers({
        rsvp_get: () =>
          householdView({ settings: { enabled_questions: {}, email_confirmation: false } }),
      }),
    );
    const off = deferred();
    const skipped = await submitStep(
      submitInput({ form: formOf([...complete, ["email", "jan@example.test"]]), defer: off.defer }),
    );
    await off.run();
    expect(skipped.state.done?.emailSent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skrytá past: odpověď vypadá přijatá, nic se nezapíše ani nepočítá", async () => {
    const db = fakeDb(listedHandlers());
    const later = deferred();
    const result = await submitStep(
      submitInput({
        form: formOf([...complete, ["website", "http://spam.example"]]),
        defer: later.defer,
      }),
    );
    expect(result.state.done).toEqual({ people: [], emailSent: false, unlisted: false });
    expect(db.of("rsvp_submit")).toHaveLength(0);
    expect(db.of("rsvp_get")).toHaveLength(0);
    expect(later.count()).toBe(0);
  });

  it("omezení: vyčerpaný limit podle IP nebo svatby vrací obecnou zprávu a nic nezapíše", async () => {
    let calls = 0;
    const db = fakeDb(
      listedHandlers({ rate_limit_hit: () => [{ allowed: ++calls !== 2, retry_after: 100 }] }),
    );
    const result = await submitStep(submitInput({ defer: deferred().defer }));
    expect(result.state).toEqual({ stage: "form", error: "limited" });
    expect(db.of("rsvp_submit")).toHaveLength(0);
    const keys = db.of("rate_limit_hit").map((c) => String(c.args.p_bucket_key).split(":")[0]);
    expect(keys.sort()).toEqual(["rsvp-submit-ip", "rsvp-submit-wedding"]);
  });

  it("chybějící nebo prošlý lístek vrací první krok a smaže cookie", async () => {
    fakeDb(listedHandlers());
    const none = await submitStep(submitInput({ ticket: null, defer: deferred().defer }));
    expect(none.state).toEqual({ stage: "name", error: "expired" });
    expect(none.ticket).toEqual({ clear: true });

    fakeDb(listedHandlers({ rsvp_get: () => null }));
    const stale = await submitStep(submitInput({ defer: deferred().defer }));
    expect(stale.state.error).toBe("expired");

    fakeDb(
      listedHandlers({
        rsvp_submit: () => {
          throw new DbError("rsvp_submit", "28000", "invalid_ticket");
        },
      }),
    );
    const rejected = await submitStep(submitInput({ defer: deferred().defer }));
    expect(rejected.state.error).toBe("expired");
    expect(rejected.ticket).toEqual({ clear: true });
  });

  it("neúplný formulář vrací chyby u polí a do databáze nejde", async () => {
    const db = fakeDb(listedHandlers());
    const result = await submitStep(
      submitInput({ form: formOf(complete.slice(0, 2)), defer: deferred().defer }),
    );
    expect(result.state.error).toBe("invalid");
    expect(result.state.errors).toMatchObject({ [`g.${G_MARIE}.ev.${E_OBRAD}`]: "required" });
    // model se neposílá, klient si ponechá vyplněné hodnoty
    expect(result.state.model).toBeUndefined();
    expect(db.of("rsvp_submit")).toHaveLength(0);
  });

  it("RSVP se mezitím uzavřelo: stav closed a smazaný lístek, nic se nepočítá", async () => {
    const db = fakeDb(
      listedHandlers({
        rsvp_submit: () => {
          throw new DbError("rsvp_submit", "55000", "rsvp_closed");
        },
      }),
    );
    const later = deferred();
    const result = await submitStep(submitInput({ defer: later.defer }));
    expect(result.state).toEqual({ stage: "closed" });
    expect(result.ticket).toEqual({ clear: true });
    await later.run();
    expect(db.of("analytics_record")).toHaveLength(0);
  });

  it("databáze odmítla obsah (neplatný host, událost): obecná chyba, ne výjimka; ostatní chyby se předají", async () => {
    fakeDb(
      listedHandlers({
        rsvp_submit: () => {
          throw new DbError("rsvp_submit", "42501", "event_not_invited");
        },
      }),
    );
    const result = await submitStep(submitInput({ defer: deferred().defer }));
    expect(result.state).toEqual({ stage: "form", error: "invalid" });

    fakeDb(
      listedHandlers({
        rsvp_submit: () => {
          throw new DbError("rsvp_submit", "08006", "chyba spojení");
        },
      }),
    );
    await expect(submitStep(submitInput({ defer: deferred().defer }))).rejects.toBeInstanceOf(
      DbError,
    );
  });

  it("host mimo seznam: zápis bez lístku, analytika vždy, potvrzení bez možnosti úprav", async () => {
    const db = fakeDb({
      ...base,
      rate_limit_hit: allow,
      rsvp_unlisted_form: () =>
        unlistedView({
          settings: { enabled_questions: { children: true }, email_confirmation: true },
        }),
      rsvp_submit_unlisted: () => ({ ok: true, response_id: "r9" }),
    });
    const later = deferred();
    const result = await submitStep(
      submitInput({
        mode: "unlisted",
        ticket: null,
        form: formOf([
          ["x.0.kind", "adult"],
          ["x.0.name", "Karel Cizí"],
          [`x.0.ev.${E_OBRAD}`, "yes"],
          [`x.0.ev.${E_HOSTINA}`, "no"],
          ["email", "karel@example.test"],
        ]),
        defer: later.defer,
      }),
    );
    expect(result.state.done).toMatchObject({ unlisted: true, emailSent: true });
    expect(result.state.model).toBeUndefined();
    expect(db.of("rsvp_submit_unlisted")[0].args).toMatchObject({
      p_payload: {
        contact_email: "karel@example.test",
        people: [{ guest_id: null, person_name: "Karel Cizí" }],
      },
    });
    expect(db.of("rsvp_submit")).toHaveLength(0);
    await later.run();
    expect(db.of("analytics_record")).toHaveLength(1);
    const message = vi.mocked(sendEmail).mock.calls[0][0];
    expect(message.text).toMatch(/nejde na webu změnit/);
    expect(message.text).not.toContain("#potvrdit-ucast");
  });

  describe("host mimo seznam: idempotence (dvojklik, opakování)", () => {
    const NONCE = "6f1f4f0e-1c2d-4a5b-8c9d-0e1f2a3b4c5d";
    const unlistedForm = () =>
      formOf([
        ["x.0.kind", "adult"],
        ["x.0.name", "Karel Cizí"],
        [`x.0.ev.${E_OBRAD}`, "yes"],
        [`x.0.ev.${E_HOSTINA}`, "no"],
        ["email", "karel@example.test"],
        ["nonce", NONCE],
      ]);
    const settings = {
      settings: { enabled_questions: { children: true }, email_confirmation: true },
    };

    it("nonce z formuláře jde do databáze beze změny", async () => {
      const db = fakeDb({
        ...base,
        rate_limit_hit: allow,
        rsvp_unlisted_form: () => unlistedView(settings),
        rsvp_submit_unlisted: () => ({ ok: true, response_id: "r9", duplicate: false }),
      });
      await submitStep(
        submitInput({
          mode: "unlisted",
          ticket: null,
          form: unlistedForm(),
          defer: deferred().defer,
        }),
      );
      expect(db.of("rsvp_submit_unlisted")[0].args).toMatchObject({ p_payload: { nonce: NONCE } });
    });

    it("bez platného nonce (starší stránka) se vygeneruje nový, odpověď se neztratí", async () => {
      const db = fakeDb({
        ...base,
        rate_limit_hit: allow,
        rsvp_unlisted_form: () => unlistedView(settings),
        rsvp_submit_unlisted: () => ({ ok: true, response_id: "r9", duplicate: false }),
      });
      for (const nonce of [null, "nesmysl"]) {
        const form = unlistedForm();
        form.delete("nonce");
        if (nonce) form.set("nonce", nonce);
        const result = await submitStep(
          submitInput({ mode: "unlisted", ticket: null, form, defer: deferred().defer }),
        );
        expect(result.state.done).toBeDefined();
      }
      const nonces = db
        .of("rsvp_submit_unlisted")
        .map((c) => (c.args.p_payload as { nonce: string }).nonce);
      expect(nonces[0]).toMatch(/^[0-9a-f-]{36}$/);
      expect(nonces[1]).not.toBe(nonces[0]);
    });

    it("opakované odeslání (duplicate): host vidí potvrzení, ale e-mail ani měření se nezopakují", async () => {
      const db = fakeDb({
        ...base,
        rate_limit_hit: allow,
        rsvp_unlisted_form: () => unlistedView(settings),
        rsvp_submit_unlisted: () => ({ ok: true, response_id: "r9", duplicate: true }),
      });
      const later = deferred();
      const result = await submitStep(
        submitInput({ mode: "unlisted", ticket: null, form: unlistedForm(), defer: later.defer }),
      );
      expect(result.state.done).toMatchObject({ unlisted: true });
      await later.run();
      expect(db.of("analytics_record")).toHaveLength(0);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("dvojklik: dvě souběžná odeslání téhož formuláře uloží jedinou odpověď a pošlou jediný e-mail", async () => {
      const seen = new Set<string>();
      fakeDb({
        ...base,
        rate_limit_hit: allow,
        rsvp_unlisted_form: () => unlistedView(settings),
        // chování databáze: druhé použití téhož nonce je duplicita
        rsvp_submit_unlisted: (args) => {
          const nonce = (args.p_payload as { nonce: string }).nonce;
          const duplicate = seen.has(nonce);
          seen.add(nonce);
          return { ok: true, response_id: "r9", duplicate };
        },
      });
      const later = deferred();
      const input = () =>
        submitInput({ mode: "unlisted", ticket: null, form: unlistedForm(), defer: later.defer });
      await Promise.all([submitStep(input()), submitStep(input())]);
      await later.run();
      expect(seen.size).toBe(1);
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  it("host mimo seznam: formulář už není (vypnuto nebo zavřeno)", async () => {
    fakeDb({ ...base, rate_limit_hit: allow, rsvp_unlisted_form: () => null });
    const result = await submitStep(
      submitInput({ mode: "unlisted", ticket: null, form: formOf([]), defer: deferred().defer }),
    );
    expect(result.state).toEqual({ stage: "closed" });

    fakeDb({
      ...base,
      rate_limit_hit: allow,
      rsvp_unlisted_form: () => unlistedView(),
      rsvp_submit_unlisted: () => {
        throw new DbError("rsvp_submit_unlisted", "42501", "unlisted_not_allowed");
      },
    });
    const off = await submitStep(
      submitInput({
        mode: "unlisted",
        ticket: null,
        form: formOf([
          ["x.0.kind", "adult"],
          ["x.0.name", "Karel Cizí"],
          [`x.0.ev.${E_OBRAD}`, "yes"],
          [`x.0.ev.${E_HOSTINA}`, "yes"],
        ]),
        defer: deferred().defer,
      }),
    );
    expect(off.state).toEqual({ stage: "name", error: "generic" });
  });
});
