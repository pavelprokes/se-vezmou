import { afterEach, describe, expect, it } from "vitest";
import { setTransport } from "@/lib/db/rpc";
import { DbError, type RpcTransport, type TenantIdentity } from "@/lib/db/transport";
import { enterResponseManually, getHouseholdForEntry, getRsvpOverview, listGuests } from "./admin";
import { householdView, E_HOSTINA, E_OBRAD, G_JAN, HOUSEHOLD, WEDDING } from "./test-fixtures";
import { householdStatus, type GuestList } from "./types";

const ADMIN = "66666666-6666-4666-8666-666666666666";
const session = { weddingId: WEDDING, subjectId: ADMIN };

type Call = { fn: string; args: Record<string, unknown>; kind: string; as?: TenantIdentity };

function fakeDb(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const transport: RpcTransport = {
    async call(fn, args, kind, as) {
      calls.push({ fn, args, kind, as });
      const handler = handlers[fn];
      if (!handler) throw new Error(`Neočekávané volání ${fn}`);
      return handler(args);
    },
  };
  setTransport(transport);
  return calls;
}

afterEach(() => setTransport(null));

const guestList: GuestList = {
  events: [
    {
      id: E_OBRAD,
      kind: "ceremony",
      title: { cs: "Obřad" },
      starts_at: "2027-06-19T12:00:00+00:00",
      rsvp_enabled: true,
    },
  ],
  households: [
    {
      id: HOUSEHOLD,
      label: "Novákovi",
      invited_note: null,
      tags: [],
      guests: [
        {
          id: G_JAN,
          display_name: "Jan Novák",
          is_child: false,
          age: null,
          is_plus_one: false,
          source: "import",
          invited_event_ids: [E_OBRAD],
          attendance: [{ event_id: E_OBRAD, attending: true }],
        },
      ],
      response: {
        id: "r1",
        submitted_at: "2026-10-02T10:00:00+00:00",
        last_edited_at: "2026-10-02T10:00:00+00:00",
        entered_by: "admin",
        has_email: false,
        attending: true,
      },
    },
    { id: "h2", label: "Svobodovi", invited_note: null, tags: [], guests: [], response: null },
    {
      id: "h3",
      label: "Dvořákovi",
      invited_note: "bez dětí",
      tags: [],
      guests: [],
      response: {
        id: "r3",
        submitted_at: "2026-10-02T10:00:00+00:00",
        last_edited_at: "2026-10-03T10:00:00+00:00",
        entered_by: "guest",
        has_email: true,
        attending: false,
      },
    },
  ],
  unlisted: [],
};

describe("správcovská vrstva RSVP (M8, UI v M7)", () => {
  it("seznam hostů a domácností se volá s totožností správce a ověří se jeho tvar", async () => {
    const calls = fakeDb({ admin_guest_list: () => guestList });
    const result = await listGuests(session);
    expect(result.households).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      fn: "admin_guest_list",
      as: { weddingId: WEDDING, weddingRole: "admin", subject: ADMIN },
    });
  });

  it("stav domácnosti: neodpověděla, někdo přijde, nikdo nepřijde", () => {
    expect(guestList.households.map(householdStatus)).toEqual([
      "attending",
      "no_response",
      "declined",
    ]);
  });

  it("neplatný tvar odpovědi databáze je chyba, ne tiché přijetí", async () => {
    fakeDb({ admin_guest_list: () => ({ households: "nic" }) });
    await expect(listGuests(session)).rejects.toThrow();
  });

  it("přehled: počty po událostech", async () => {
    const overview = {
      households: { total: 3, answered: 2, pending: 1 },
      guests: { total: 5, children: 1 },
      extra_people: { plus_ones: 1, unlisted: 0, added_children: 0 },
      events: [
        {
          event_id: E_OBRAD,
          kind: "ceremony",
          title: { cs: "Obřad" },
          starts_at: "2027-06-19T12:00:00+00:00",
          invited: 5,
          attending: 3,
          declined: 1,
          attending_extra: 1,
          pending: 1,
        },
      ],
    };
    fakeDb({ admin_rsvp_overview: () => overview });
    expect(await getRsvpOverview(session)).toEqual(overview);
  });

  it("domácnost pro ruční zápis: cizí domácnost je null", async () => {
    const calls = fakeDb({
      admin_rsvp_household: (args) => (args.p_household_id === HOUSEHOLD ? householdView() : null),
    });
    expect((await getHouseholdForEntry(session, HOUSEHOLD))?.guests).toHaveLength(3);
    expect(await getHouseholdForEntry(session, "cizi")).toBeNull();
    expect(calls[0].args).toEqual({ p_household_id: HOUSEHOLD });
  });

  describe("ruční zápis hosta, který odpověděl telefonem", () => {
    const entry = {
      answers: { lodging: "need" },
      people: [
        {
          guest_id: G_JAN,
          diet: "bez ořechů",
          attendance: [
            { event_id: E_OBRAD, attending: true },
            { event_id: E_HOSTINA, attending: false },
          ],
        },
      ],
    };

    it("pošle ověřený obsah s totožností správce", async () => {
      const calls = fakeDb({ admin_rsvp_enter: () => ({ ok: true, response_id: "r1" }) });
      expect(await enterResponseManually(session, HOUSEHOLD, entry)).toEqual({ ok: true });
      expect(calls[0]).toMatchObject({
        fn: "admin_rsvp_enter",
        as: { weddingRole: "admin", subject: ADMIN },
        args: { p_household_id: HOUSEHOLD, p_payload: entry },
      });
    });

    it("neplatný vstup se do databáze vůbec nepošle", async () => {
      const calls = fakeDb({ admin_rsvp_enter: () => ({ ok: true }) });
      const bad = [
        { people: [] },
        { people: [{ guest_id: "neni-uuid", attendance: [] }] },
        { people: [{ guest_id: null, person_name: "x".repeat(201), attendance: [] }] },
        { people: [{ guest_id: G_JAN, attendance: [{ event_id: E_OBRAD, attending: "ano" }] }] },
        {
          people: [
            { guest_id: null, person_name: "Dítě", is_child: true, age: 30, attendance: [] },
          ],
        },
      ];
      for (const value of bad) {
        expect(await enterResponseManually(session, HOUSEHOLD, value as never)).toEqual({
          ok: false,
          reason: "invalid",
        });
      }
      expect(await enterResponseManually(session, "neni-uuid", entry)).toEqual({
        ok: false,
        reason: "invalid",
      });
      expect(calls).toHaveLength(0);
    });

    it("domácnost jiné svatby a odmítnutý obsah mají vlastní důvod, ostatní chyby se předají", async () => {
      fakeDb({
        admin_rsvp_enter: () => {
          throw new DbError("admin_rsvp_enter", "P0002", "household_not_found");
        },
      });
      expect(await enterResponseManually(session, HOUSEHOLD, entry)).toEqual({
        ok: false,
        reason: "household_not_found",
      });

      fakeDb({
        admin_rsvp_enter: () => {
          throw new DbError("admin_rsvp_enter", "42501", "event_not_invited");
        },
      });
      expect(await enterResponseManually(session, HOUSEHOLD, entry)).toEqual({
        ok: false,
        reason: "invalid",
      });

      fakeDb({
        admin_rsvp_enter: () => {
          throw new DbError("admin_rsvp_enter", "42501", "forbidden");
        },
      });
      await expect(enterResponseManually(session, HOUSEHOLD, entry)).rejects.toBeInstanceOf(
        DbError,
      );
    });
  });
});
