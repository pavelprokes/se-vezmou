import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.RATE_LIMIT_SECRET = "rate-secret-rate-secret-rate-secret-1";
});

import { setTransport } from "@/lib/db/rpc";
import { DbError } from "@/lib/db/transport";
import { toXlsx } from "@/lib/export/xlsx";
import {
  bulkInvite,
  commitImport,
  deleteHousehold,
  loadRsvpSettings,
  previewImport,
  saveHousehold,
  saveRsvpSettings,
} from "./server";
import { rsvpWindow } from "./types";

const WEDDING = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const SESSION = { weddingId: WEDDING, subjectId: ADMIN };
const EVENT = "33333333-3333-4333-8333-333333333333";
const HOUSEHOLD = "44444444-4444-4444-8444-444444444444";

type Call = { fn: string; args: Record<string, unknown>; as?: unknown };

const GUEST_LIST = {
  events: [
    {
      id: EVENT,
      kind: "ceremony",
      title: { cs: "Obřad" },
      starts_at: "2027-06-19T12:00:00+00:00",
      rsvp_enabled: true,
    },
  ],
  households: [
    {
      id: HOUSEHOLD,
      label: "Dvořákovi",
      invited_note: null,
      guests: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          display_name: "Petr Dvořák",
          is_child: false,
          age: null,
          is_plus_one: false,
          source: "manual",
          invited_event_ids: [EVENT],
          attendance: [],
        },
      ],
      response: null,
    },
  ],
  unlisted: [],
};

function fakeDb(
  options: {
    rateAllowed?: boolean;
    fail?: Record<string, DbError>;
    settings?: unknown;
  } = {},
) {
  const calls: Call[] = [];
  setTransport({
    async call(fn, args, _kind, as) {
      calls.push({ fn, args, as });
      if (options.fail?.[fn]) throw options.fail[fn];
      switch (fn) {
        case "rate_limit_hit": {
          const allowed = options.rateAllowed ?? true;
          return [{ allowed, retry_after: allowed ? 0 : 77 }];
        }
        case "admin_guest_list":
          return GUEST_LIST;
        case "admin_household_save":
          return HOUSEHOLD;
        case "admin_household_delete":
        case "admin_rsvp_settings_save":
          return null;
        case "admin_invitations_bulk":
          return 3;
        case "admin_guests_import":
          return { households: 2, guests: 3 };
        case "admin_rsvp_settings_get":
          return options.settings;
        default:
          throw new Error(`Neočekávané volání ${fn}`);
      }
    },
  });
  return calls;
}

afterEach(() => setTransport(null));

const guest = (over: Record<string, unknown> = {}) => ({
  id: null,
  displayName: "  Karel Novák ",
  isChild: false,
  age: null,
  invitedEventIds: [EVENT],
  ...over,
});

describe("saveHousehold", () => {
  it("uloží domácnost s claimy správce a převede ji na tvar databáze", async () => {
    const calls = fakeDb();
    const result = await saveHousehold(SESSION, null, {
      label: " Novákovi ",
      note: "",
      guests: [guest(), guest({ displayName: "Anička", isChild: true, age: 8 })],
    });
    expect(result).toEqual({ status: "saved", householdId: HOUSEHOLD });
    const save = calls.find((c) => c.fn === "admin_household_save")!;
    expect(save.as).toMatchObject({ weddingId: WEDDING, weddingRole: "admin", subject: ADMIN });
    expect(save.args.p_household_id).toBeNull();
    expect(save.args.p_payload).toEqual({
      label: "Novákovi",
      note: null,
      guests: [
        {
          id: null,
          display_name: "Karel Novák",
          is_child: false,
          age: null,
          invited_event_ids: [EVENT],
        },
        { id: null, display_name: "Anička", is_child: true, age: 8, invited_event_ids: [EVENT] },
      ],
    });
  });

  it("věk dospělého se do databáze nikdy nepošle", async () => {
    const calls = fakeDb();
    await saveHousehold(SESSION, null, { label: "", note: null, guests: [guest({ age: 9 })] });
    const payload = calls.find((c) => c.fn === "admin_household_save")!.args.p_payload as {
      guests: { age: number | null }[];
    };
    expect(payload.guests[0].age).toBeNull();
  });

  it("neplatný vstup se odmítne ještě před databází", async () => {
    const calls = fakeDb();
    for (const bad of [
      { label: "", note: null, guests: [] },
      { label: "", note: null, guests: [guest({ displayName: "   " })] },
      { label: "", note: null, guests: [guest({ isChild: true, age: 18 })] },
      { label: "", note: null, guests: [guest({ age: 40 })] },
      { label: "x".repeat(201), note: null, guests: [guest()] },
      { label: "", note: null, guests: [guest({ invitedEventIds: ["neni-uuid"] })] },
      "nesmysl",
    ]) {
      expect(await saveHousehold(SESSION, null, bad)).toEqual({ status: "invalid" });
    }
    expect(
      await saveHousehold(SESSION, "neni-uuid", { label: "", note: null, guests: [guest()] }),
    ).toEqual({
      status: "invalid",
    });
    expect(calls).toEqual([]);
  });

  it("chyby databáze se mapují na stavy, ostatní se vyhodí dál", async () => {
    fakeDb({
      fail: {
        admin_household_save: new DbError("admin_household_save", "P0002", "household_not_found"),
      },
    });
    expect(
      await saveHousehold(SESSION, HOUSEHOLD, { label: "", note: null, guests: [guest()] }),
    ).toEqual({
      status: "not_found",
    });
    fakeDb({
      fail: {
        admin_household_save: new DbError("admin_household_save", "22023", "guest_limit_exceeded"),
      },
    });
    expect(
      await saveHousehold(SESSION, null, { label: "", note: null, guests: [guest()] }),
    ).toEqual({
      status: "guest_limit",
    });
    fakeDb({
      fail: { admin_household_save: new DbError("admin_household_save", "22023", "invalid_event") },
    });
    expect(
      await saveHousehold(SESSION, null, { label: "", note: null, guests: [guest()] }),
    ).toEqual({
      status: "invalid",
    });
    fakeDb({
      fail: { admin_household_save: new DbError("admin_household_save", "XX000", "boom") },
    });
    await expect(
      saveHousehold(SESSION, null, { label: "", note: null, guests: [guest()] }),
    ).rejects.toThrow();
  });

  it("po překročení limitu počtu změn databázi nevolá", async () => {
    const calls = fakeDb({ rateAllowed: false });
    expect(
      await saveHousehold(SESSION, null, { label: "", note: null, guests: [guest()] }),
    ).toEqual({
      status: "limited",
      retryAfter: 77,
    });
    expect(calls.map((c) => c.fn)).toEqual(["rate_limit_hit"]);
  });
});

describe("deleteHousehold a bulkInvite", () => {
  it("smaže domácnost a cizí identifikátor odmítne", async () => {
    const calls = fakeDb();
    expect(await deleteHousehold(SESSION, HOUSEHOLD)).toEqual({ status: "deleted" });
    expect(await deleteHousehold(SESSION, "nesmysl")).toEqual({ status: "not_found" });
    expect(calls.filter((c) => c.fn === "admin_household_delete")).toHaveLength(1);
  });

  it("neexistující domácnost je stav, ne výjimka", async () => {
    fakeDb({
      fail: {
        admin_household_delete: new DbError(
          "admin_household_delete",
          "P0002",
          "household_not_found",
        ),
      },
    });
    expect(await deleteHousehold(SESSION, HOUSEHOLD)).toEqual({ status: "not_found" });
  });

  it("hromadné pozvání vrací počet řádků a odmítne špatný vstup", async () => {
    fakeDb();
    expect(await bulkInvite(SESSION, EVENT, true)).toEqual({ status: "ok", rows: 3 });
    expect(await bulkInvite(SESSION, "x", true)).toEqual({ status: "invalid" });
    expect(await bulkInvite(SESSION, EVENT, "ano")).toEqual({ status: "invalid" });
  });
});

describe("import hostů", () => {
  const csv = (text: string) => new TextEncoder().encode(text);

  it("náhled označí duplicity s hosty v seznamu a nic nezapisuje", async () => {
    const calls = fakeDb();
    const result = await previewImport(
      SESSION,
      csv("Jméno;Domácnost\nDvořák Petr;\nEva Nová;Novákovi\n;Novákovi\n"),
    );
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.rows.map((row) => [row.name, row.duplicate, row.problem])).toEqual([
      ["Dvořák Petr", "existing", null],
      ["Eva Nová", null, null],
      ["", null, "name_missing"],
    ]);
    expect(result.totals).toMatchObject({ rows: 3, importable: 1, errors: 1, duplicates: 1 });
    expect(calls.some((c) => c.fn === "admin_guests_import")).toBe(false);
  });

  it("náhled z Excelu funguje stejně a chybný soubor dá důvod", async () => {
    fakeDb();
    const xlsx = new Uint8Array(
      await toXlsx({ name: "H", headers: ["Jméno"], rows: [["Eva Nová"]] }),
    );
    const ok = await previewImport(SESSION, xlsx);
    expect(ok.status).toBe("ok");
    expect(await previewImport(SESSION, csv("Telefon\n123"))).toEqual({
      status: "failed",
      reason: "no_name_column",
    });
    expect(await previewImport(SESSION, new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0]))).toEqual({
      status: "failed",
      reason: "unsupported_format",
    });
  });

  it("zápis ověří řádky znovu, vynechá chyby a duplicity a pošle pozvání", async () => {
    const calls = fakeDb();
    const result = await commitImport(SESSION, {
      rows: [
        { line: 2, household: "Novákovi", name: "Eva Nová", isChild: false, age: null },
        { line: 3, household: "Novákovi", name: "Tomáš Nový", isChild: true, age: 6 },
        { line: 4, household: "", name: "Dvořák Petr", isChild: false, age: null },
        { line: 5, household: "", name: "", isChild: false, age: null },
        { line: 6, household: "", name: "Dospělý", isChild: false, age: 33 },
      ],
      includeDuplicates: false,
      eventIds: [EVENT],
    });
    expect(result).toEqual({ status: "imported", households: 2, guests: 3 });
    const call = calls.find((c) => c.fn === "admin_guests_import")!;
    expect(call.args.p_payload).toEqual({
      households: [
        {
          label: "Novákovi",
          guests: [
            { display_name: "Eva Nová", is_child: false, age: null },
            { display_name: "Tomáš Nový", is_child: true, age: 6 },
          ],
        },
        // věk u dospělého se zahodí, řádek zůstává platný
        { label: "", guests: [{ display_name: "Dospělý", is_child: false, age: null }] },
      ],
      invited_event_ids: [EVENT],
    });
  });

  it("duplicity se zapíšou jen na výslovnou volbu", async () => {
    const calls = fakeDb();
    await commitImport(SESSION, {
      rows: [{ line: 2, household: "", name: "Petr Dvořák", isChild: false, age: null }],
      includeDuplicates: true,
      eventIds: [],
    });
    const payload = calls.find((c) => c.fn === "admin_guests_import")!.args.p_payload as {
      households: unknown[];
    };
    expect(payload.households).toHaveLength(1);
  });

  it("není co importovat; neplatný vstup a limit hostů jsou stavy", async () => {
    fakeDb();
    expect(
      await commitImport(SESSION, {
        rows: [{ line: 2, household: "", name: "Petr Dvořák", isChild: false, age: null }],
        includeDuplicates: false,
        eventIds: [],
      }),
    ).toEqual({ status: "nothing" });
    expect(
      await commitImport(SESSION, { rows: [], includeDuplicates: false, eventIds: [] }),
    ).toEqual({
      status: "invalid",
    });
    expect(await commitImport(SESSION, "x")).toEqual({ status: "invalid" });

    fakeDb({
      fail: {
        admin_guests_import: new DbError("admin_guests_import", "22023", "guest_limit_exceeded"),
      },
    });
    expect(
      await commitImport(SESSION, {
        rows: [{ line: 2, household: "", name: "Nový host", isChild: false, age: null }],
        includeDuplicates: false,
        eventIds: [],
      }),
    ).toEqual({ status: "guest_limit" });
  });

  it("import podléhá omezení počtu požadavků (cizí soubor je drahý)", async () => {
    const calls = fakeDb({ rateAllowed: false });
    expect(await previewImport(SESSION, csv("Jméno\nEva"))).toEqual({
      status: "limited",
      retryAfter: 77,
    });
    expect(calls.map((c) => c.fn)).toEqual(["rate_limit_hit"]);
  });
});

describe("nastavení RSVP", () => {
  const view = {
    timezone: "Europe/Prague",
    locales: ["cs"],
    default_locale: "cs",
    settings: {
      opens_at: null,
      closes_at: null,
      allow_unlisted: false,
      email_confirmation: true,
      enabled_questions: { diet: true },
    },
    questions: [],
    events: [],
  };

  it("načte nastavení a ověří jeho tvar", async () => {
    fakeDb({ settings: view });
    expect((await loadRsvpSettings(SESSION)).settings.email_confirmation).toBe(true);
    fakeDb({ settings: { nesmysl: 1 } });
    await expect(loadRsvpSettings(SESSION)).rejects.toThrow();
  });

  const input = (over: Record<string, unknown> = {}) => ({
    opensAt: null,
    closesAt: null,
    allowUnlisted: true,
    emailConfirmation: false,
    enabledQuestions: { diet: true, song: false },
    questions: [],
    ...over,
  });

  it("uloží nastavení v tvaru databáze", async () => {
    const calls = fakeDb();
    expect(
      await saveRsvpSettings(
        SESSION,
        input({
          closesAt: "2027-06-01T00:00:00+02:00",
          questions: [
            {
              id: null,
              key: "menu",
              type: "choice",
              label: { cs: "Menu" },
              options: [
                { value: "maso", label: { cs: "Maso" } },
                { value: "ryba", label: { cs: "Ryba" } },
              ],
              required: true,
              eventId: EVENT,
              enabled: true,
            },
            {
              id: null,
              key: "bus",
              type: "bool",
              label: { cs: "Autobus?" },
              options: [{ value: "a", label: { cs: "A" } }],
              required: false,
              eventId: null,
              enabled: true,
            },
          ],
        }),
      ),
    ).toEqual({ status: "saved" });
    const payload = calls.find((c) => c.fn === "admin_rsvp_settings_save")!.args.p_payload as {
      closes_at: string;
      allow_unlisted: boolean;
      questions: { options: unknown; event_id: string | null }[];
    };
    expect(payload.closes_at).toBe("2027-06-01T00:00:00+02:00");
    expect(payload.allow_unlisted).toBe(true);
    expect(payload.questions[0].event_id).toBe(EVENT);
    // možnosti se posílají jen u výběru
    expect(payload.questions[1].options).toBeNull();
  });

  it("uzavření před otevřením, neplatný klíč a neznámý příznak se odmítnou před databází", async () => {
    const calls = fakeDb();
    expect(
      await saveRsvpSettings(
        SESSION,
        input({ opensAt: "2027-06-02T00:00:00Z", closesAt: "2027-06-01T00:00:00Z" }),
      ),
    ).toEqual({ status: "invalid", reason: "period" });
    expect(await saveRsvpSettings(SESSION, input({ enabledQuestions: { neznamy: true } }))).toEqual(
      {
        status: "invalid",
      },
    );
    expect(
      await saveRsvpSettings(
        SESSION,
        input({
          questions: [
            {
              id: null,
              key: "Velke",
              type: "text",
              label: {},
              options: null,
              required: false,
              eventId: null,
              enabled: true,
            },
          ],
        }),
      ),
    ).toEqual({ status: "invalid" });
    expect(calls).toEqual([]);
  });

  it("chyby databáze se mapují na důvod", async () => {
    fakeDb({
      fail: {
        admin_rsvp_settings_save: new DbError(
          "admin_rsvp_settings_save",
          "22023",
          "invalid_question",
        ),
      },
    });
    expect(await saveRsvpSettings(SESSION, input())).toEqual({
      status: "invalid",
      reason: "question",
    });
    fakeDb({
      fail: {
        admin_rsvp_settings_save: new DbError("admin_rsvp_settings_save", "22023", "invalid_event"),
      },
    });
    expect(await saveRsvpSettings(SESSION, input())).toEqual({
      status: "invalid",
      reason: "event",
    });
  });
});

describe("rsvpWindow", () => {
  const now = new Date("2027-03-01T12:00:00Z");
  it("otevřeno, naplánováno a uzavřeno", () => {
    expect(rsvpWindow(null, null, now)).toBe("open");
    expect(rsvpWindow("2027-04-01T00:00:00Z", null, now)).toBe("scheduled");
    expect(rsvpWindow(null, "2027-02-01T00:00:00Z", now)).toBe("closed");
    expect(rsvpWindow("2027-01-01T00:00:00Z", "2027-06-01T00:00:00Z", now)).toBe("open");
  });
});
