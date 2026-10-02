import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET = "auth-secret-auth-secret-auth-secret-1";
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
  process.env.OPERATOR_MFA_KEY = "operator-mfa-key-operator-mfa-key-0001";
  process.env.ROOT_DOMAIN = "localhost";
});

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  headers: {} as Record<string, string>,
  revalidatePath: vi.fn(),
  after: [] as (() => Promise<unknown>)[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "sv_operator" && mocks.cookie ? { name, value: mocks.cookie } : undefined,
  }),
  headers: async () => new Headers(mocks.headers),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/server", () => ({
  after: (task: () => Promise<unknown>) => void mocks.after.push(task),
}));
vi.mock("@/lib/email/transport", () => ({
  sendEmail: vi.fn(async () => ({ providerMessageId: "msg-1" })),
}));

import { setTransport } from "@/lib/db/rpc";
import { DbError, type RpcTransport } from "@/lib/db/transport";
import { sendEmail } from "@/lib/email/transport";
import {
  addNoteAction,
  changeSlugAction,
  changeStatusAction,
  extendRetentionAction,
  restoreWeddingAction,
  sendLoginLinkAction,
  viewGuestDataAction,
} from "./wedding";

const OPERATOR = "11111111-1111-4111-8111-111111111111";
const SESSION = "33333333-3333-4333-8333-333333333333";
const WEDDING = "55555555-5555-4555-8555-555555555555";
const ADMIN = "66666666-6666-4666-8666-666666666666";
const TOKEN = "A".repeat(43);

type Call = { fn: string; args: Record<string, unknown> };
type Handler = (args: Record<string, unknown>) => unknown;

function fakeDb(handlers: Record<string, Handler> = {}) {
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
  return { calls, ops: () => calls.filter((c) => c.fn.startsWith("op_")).map((c) => c.fn) };
}

function session(role: "owner" | "support", aal2 = true): Handler {
  return () => [
    {
      session_id: SESSION,
      operator_id: OPERATOR,
      email: "operator@example.cz",
      role,
      aal2,
      totp_confirmed: true,
    },
  ];
}

/** Úspěšný zásah končí přesměrováním na stránku zakázky s hlášením; vrací cílovou adresu. */
async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const match = /^REDIRECT:(.*)$/.exec((error as Error).message);
    if (match) return match[1];
    throw error;
  }
  throw new Error("Akce nepřesměrovala");
}

const done = (result: string) => `/zakazky/${WEDDING}?vysledek=${result}`;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const detail = (overrides: Record<string, unknown> = {}) => ({
  wedding: {
    id: WEDDING,
    slug: "klara-a-matej",
    status: "published",
    template: "editorial",
    palette: "default",
    default_locale: "cs",
    locales: ["cs"],
    partner_a_name: "Klára",
    partner_b_name: "Matěj",
    starts_on: "2027-06-12",
    ends_on: null,
    timezone: "Europe/Prague",
    published_at: null,
    blocked_at: null,
    deleted_at: null,
    purge_at: null,
    health_purge_at: null,
    guest_purge_at: null,
    created_at: "2026-10-01T10:00:00+00:00",
    last_activity_at: "2026-10-01T10:00:00+00:00",
    published_version_no: 1,
    has_preview: false,
    restorable: false,
  },
  order: null,
  slug_state: null,
  admins: [
    {
      id: ADMIN,
      email: "Spravce@Example.cz",
      added_at: "2026-10-01T10:00:00+00:00",
      removed_at: null,
      last_login_at: null,
    },
  ],
  history: [],
  notes: [],
  counts: { guests: 2, households: 1, responses: 0 },
  guest_access: null,
  ...overrides,
});

beforeEach(() => {
  mocks.cookie = TOKEN;
  mocks.headers = { host: "admin.localhost:3100", origin: "http://admin.localhost:3100" };
  mocks.after.length = 0;
  mocks.revalidatePath.mockClear();
  vi.mocked(sendEmail).mockClear();
});

afterEach(() => setTransport(null));

describe("ověření před každým zásahem", () => {
  it("bez cookie relace se nic nevolá a vrátí se chyba relace", async () => {
    mocks.cookie = undefined;
    const db = fakeDb();
    const result = await changeStatusAction(
      null,
      form({ weddingId: WEDDING, status: "blocked", reason: "Zneužití" }),
    );
    expect(result).toEqual({ error: "session" });
    expect(db.calls).toHaveLength(0);
  });

  it("cizí původ požadavku se odmítne dřív, než se sáhne na relaci", async () => {
    mocks.headers = { host: "admin.localhost:3100", origin: "http://zlo.example" };
    const db = fakeDb();
    expect(await addNoteAction(null, form({ weddingId: WEDDING, body: "Poznámka" }))).toEqual({
      error: "origin",
    });
    mocks.headers = { host: "admin.localhost:3100" };
    expect(await addNoteAction(null, form({ weddingId: WEDDING, body: "Poznámka" }))).toEqual({
      error: "origin",
    });
    expect(db.calls).toHaveLength(0);
  });

  it("relace jen s prvním faktorem (AAL1) nesmí nic provést", async () => {
    const db = fakeDb({ auth_operator_validate_session: session("owner", false) });
    expect(
      await changeStatusAction(
        null,
        form({ weddingId: WEDDING, status: "archived", reason: "Důvod" }),
      ),
    ).toEqual({ error: "session" });
    expect(db.ops()).toEqual([]);
  });

  it("neplatný token v cookie se do databáze ani neposílá", async () => {
    mocks.cookie = "kratky";
    const db = fakeDb();
    expect(await addNoteAction(null, form({ weddingId: WEDDING, body: "x" }))).toEqual({
      error: "session",
    });
    expect(db.calls).toHaveLength(0);
  });

  it("neplatný identifikátor zakázky", async () => {
    fakeDb({ auth_operator_validate_session: session("owner") });
    expect(await addNoteAction(null, form({ weddingId: "ne-uuid", body: "x" }))).toEqual({
      error: "notFound",
    });
  });
});

describe("role: podpora vs majitel", () => {
  it("podpora smí zablokovat, ne měnit ostatní stavy", async () => {
    const db = fakeDb({
      auth_operator_validate_session: session("support"),
      op_set_wedding_status: () => null,
    });
    expect(
      await changeStatusAction(
        null,
        form({ weddingId: WEDDING, status: "archived", reason: "Důvod" }),
      ),
    ).toEqual({ error: "forbidden" });
    expect(db.ops()).toEqual([]);

    expect(
      await redirectTarget(
        changeStatusAction(
          null,
          form({ weddingId: WEDDING, status: "blocked", reason: "Hlášení zneužití" }),
        ),
      ),
    ).toBe(done("status"));
    expect(db.calls.find((c) => c.fn === "op_set_wedding_status")!.args).toMatchObject({
      p_operator_id: OPERATOR,
      p_wedding_id: WEDDING,
      p_status: "blocked",
      p_reason: "Hlášení zneužití",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/h/admin/zakazky/${WEDDING}`);
  });

  it("podpora nesmí změnit adresu, prodloužit lhůtu ani obnovit web (databáze se nevolá)", async () => {
    const db = fakeDb({ auth_operator_validate_session: session("support") });
    expect(
      await changeSlugAction(null, form({ weddingId: WEDDING, slug: "nova", reason: "Důvod" })),
    ).toEqual({ error: "forbidden" });
    expect(
      await extendRetentionAction(
        null,
        form({ weddingId: WEDDING, kind: "service", until: "2030-01-01", reason: "Důvod" }),
      ),
    ).toEqual({ error: "forbidden" });
    expect(await restoreWeddingAction(null, form({ weddingId: WEDDING, reason: "Důvod" }))).toEqual(
      { error: "forbidden" },
    );
    expect(db.ops()).toEqual([]);
  });

  it("majitel změní stav i adresu a prodlouží lhůtu", async () => {
    const db = fakeDb({
      auth_operator_validate_session: session("owner"),
      op_set_wedding_status: () => null,
      op_change_slug: () => null,
      op_extend_retention: () => null,
    });
    expect(
      await redirectTarget(
        changeStatusAction(
          null,
          form({ weddingId: WEDDING, status: "published", reason: "Odblokováno" }),
        ),
      ),
    ).toBe(done("status"));
    expect(
      await redirectTarget(
        changeSlugAction(
          null,
          form({
            weddingId: WEDDING,
            slug: " https://Klara-Matej-2027.se-vezmou.cz/ ",
            reason: "Přání",
          }),
        ),
      ),
    ).toBe(done("slug"));
    expect(
      await redirectTarget(
        extendRetentionAction(
          null,
          form({ weddingId: WEDDING, kind: "guests", until: "2029-05-01", reason: "Žádost" }),
        ),
      ),
    ).toBe(done("extend"));
    expect(db.calls.find((c) => c.fn === "op_change_slug")!.args.p_slug).toBe("klara-matej-2027");
    expect(db.calls.find((c) => c.fn === "op_extend_retention")!.args).toMatchObject({
      p_kind: "guests",
      p_until: "2029-05-01",
    });
  });
});

describe("kontrola vstupu a chyby databáze", () => {
  beforeEach(() => {
    fakeDb({ auth_operator_validate_session: session("owner") });
  });

  it("bez důvodu se zásah nespustí a hodnoty zůstanou ve formuláři", async () => {
    expect(
      await changeSlugAction(null, form({ weddingId: WEDDING, slug: "nova-adresa", reason: "  " })),
    ).toEqual({
      error: "reason",
      field: "reason",
      values: { slug: "nova-adresa", reason: "  " },
    });
  });

  it("neplatná adresa, stav, druh a datum", async () => {
    expect(
      await changeSlugAction(
        null,
        form({ weddingId: WEDDING, slug: "Špatná adresa", reason: "x" }),
      ),
    ).toMatchObject({ error: "invalidSlug", field: "slug" });
    expect(
      await changeStatusAction(null, form({ weddingId: WEDDING, status: "nic", reason: "x" })),
    ).toMatchObject({ error: "invalidStatus", field: "status" });
    expect(
      await extendRetentionAction(
        null,
        form({ weddingId: WEDDING, kind: "nic", until: "2030-01-01", reason: "x" }),
      ),
    ).toMatchObject({ error: "invalidKind", field: "kind" });
    expect(
      await extendRetentionAction(
        null,
        form({ weddingId: WEDDING, kind: "service", until: "2030-02-31", reason: "x" }),
      ),
    ).toMatchObject({ error: "invalidDate", field: "until" });
    expect(
      await addNoteAction(null, form({ weddingId: WEDDING, body: "x".repeat(2001) })),
    ).toMatchObject({
      error: "invalidNote",
      field: "body",
    });
  });

  it("chyba databáze se převede na krátký klíč a nenese text s údaji", async () => {
    fakeDb({
      auth_operator_validate_session: session("owner"),
      op_change_slug: () => {
        throw new DbError("op_change_slug", "23505", "slug_unavailable");
      },
      op_restore_wedding: () => {
        throw new DbError("op_restore_wedding", "55000", "not_restorable");
      },
      op_extend_retention: () => {
        throw new DbError("op_extend_retention", "22023", "not_an_extension");
      },
      op_add_note: () => {
        throw new DbError("op_add_note", undefined, "chyba spojení");
      },
    });
    expect(
      await changeSlugAction(null, form({ weddingId: WEDDING, slug: "obsazena", reason: "x" })),
    ).toMatchObject({ error: "slugUnavailable", field: "slug" });
    expect(
      await restoreWeddingAction(null, form({ weddingId: WEDDING, reason: "x" })),
    ).toMatchObject({ error: "notRestorable" });
    expect(
      await extendRetentionAction(
        null,
        form({ weddingId: WEDDING, kind: "service", until: "2030-01-01", reason: "x" }),
      ),
    ).toMatchObject({ error: "notExtension", field: "until" });
    expect(
      await addNoteAction(null, form({ weddingId: WEDDING, body: "Soukromé jméno Jan Novák" })),
    ).toMatchObject({ error: "generic", field: undefined });
  });
});

describe("přihlašovací odkaz správci", () => {
  const rate = () => [{ allowed: true, retry_after: 0 }];

  it("pošle e-mail s odkazem na app. až po odpovědi a ověří e-mail vrácený databází", async () => {
    const db = fakeDb({
      auth_operator_validate_session: session("support"),
      op_get_wedding: () => detail(),
      rate_limit_hit: rate,
      op_send_login_link: () => "spravce@example.cz",
      email_log_insert: () => "44444444-4444-4444-8444-444444444444",
      email_log_set_status: () => true,
    });
    const target = await redirectTarget(
      sendLoginLinkAction(null, form({ weddingId: WEDDING, adminId: ADMIN })),
    );
    expect(target).toBe(done("link"));
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
    expect(mocks.after).toHaveLength(1);

    const call = db.calls.find((c) => c.fn === "op_send_login_link")!;
    expect(call.args).toMatchObject({
      p_operator_id: OPERATOR,
      p_wedding_id: WEDDING,
      p_admin_id: ADMIN,
      p_ttl_seconds: 600,
    });
    expect((call.args.p_code_hash as Buffer).length).toBe(32);

    await mocks.after[0]();
    const message = vi.mocked(sendEmail).mock.calls[0][0];
    expect(message.to).toBe("spravce@example.cz");
    expect(message.text).toMatch(/http:\/\/app\.localhost:3100\/prihlaseni\/odkaz\?t=/);
    expect(message.text).not.toContain("admin.localhost");
  });

  it("e-mail správce se mezitím změnil: kód se neposílá", async () => {
    fakeDb({
      auth_operator_validate_session: session("owner"),
      op_get_wedding: () => detail(),
      rate_limit_hit: rate,
      op_send_login_link: () => "jiny@example.cz",
    });
    expect(
      await sendLoginLinkAction(null, form({ weddingId: WEDDING, adminId: ADMIN })),
    ).toMatchObject({ error: "generic" });
    expect(mocks.after).toHaveLength(0);
  });

  it("odebraný nebo cizí správce se odmítne, limit se hlásí", async () => {
    fakeDb({
      auth_operator_validate_session: session("owner"),
      op_get_wedding: () => detail(),
      rate_limit_hit: () => [{ allowed: false, retry_after: 100 }],
    });
    expect(
      await sendLoginLinkAction(
        null,
        form({ weddingId: WEDDING, adminId: "77777777-7777-4777-8777-777777777777" }),
      ),
    ).toEqual({ error: "notFound", field: "adminId" });
    expect(await sendLoginLinkAction(null, form({ weddingId: WEDDING, adminId: ADMIN }))).toEqual({
      error: "limited",
    });
  });
});

describe("nahlédnutí do údajů hostů", () => {
  const row = {
    household_label: "Rodina Nováků",
    guest_id: "88888888-8888-4888-8888-888888888888",
    display_name: "Jan Novák",
    is_child: false,
    age: null,
    is_plus_one: false,
    diet: "vegetariánská",
    allergies: null,
  };
  const rate = () => [{ allowed: true, retry_after: 0 }];

  it("bez souhlasu páru nevrátí nic a ohlásí odmítnutí (v databázi je zapsáno do auditu)", async () => {
    const db = fakeDb({
      auth_operator_validate_session: session("support"),
      op_get_wedding: () => detail(),
      op_view_guest_data: () => [],
      rate_limit_hit: rate,
    });
    const result = await viewGuestDataAction(null, form({ weddingId: WEDDING, reason: "Pomoc" }));
    expect(result).toEqual({ ok: true, data: { outcome: "denied", rows: [] } });
    expect(db.calls.find((c) => c.fn === "op_view_guest_data")!.args.p_reason).toBe("Pomoc");
  });

  it("se souhlasem vrátí hosty; souhlas bez hostů je „prázdné“", async () => {
    fakeDb({
      auth_operator_validate_session: session("support"),
      op_get_wedding: () => detail({ guest_access: { expires_at: "2026-10-05T10:00:00+00:00" } }),
      op_view_guest_data: () => [row],
      rate_limit_hit: rate,
    });
    const withRows = await viewGuestDataAction(null, form({ weddingId: WEDDING, reason: "Pomoc" }));
    expect(withRows?.data?.outcome).toBe("rows");
    expect(withRows?.data?.rows[0]).toMatchObject({
      displayName: "Jan Novák",
      diet: "vegetariánská",
    });

    fakeDb({
      auth_operator_validate_session: session("support"),
      op_get_wedding: () => detail({ guest_access: { expires_at: "2026-10-05T10:00:00+00:00" } }),
      op_view_guest_data: () => [],
      rate_limit_hit: rate,
    });
    expect(
      (await viewGuestDataAction(null, form({ weddingId: WEDDING, reason: "Pomoc" })))?.data
        ?.outcome,
    ).toBe("empty");
  });

  it("bez důvodu se databáze nevolá; limit počtu nahlédnutí se hlásí", async () => {
    const db = fakeDb({
      auth_operator_validate_session: session("owner"),
      rate_limit_hit: rate,
    });
    expect(
      await viewGuestDataAction(null, form({ weddingId: WEDDING, reason: " " })),
    ).toMatchObject({
      error: "reason",
      field: "reason",
    });
    expect(db.ops()).toEqual([]);

    fakeDb({
      auth_operator_validate_session: session("owner"),
      rate_limit_hit: () => [{ allowed: false, retry_after: 100 }],
    });
    expect(
      await viewGuestDataAction(null, form({ weddingId: WEDDING, reason: "Pomoc" })),
    ).toMatchObject({ error: "limited" });
  });
});
