import { describe, expect, it } from "vitest";
import type { GuestList } from "@/lib/rsvp/types";
import { nameCardNames } from "./names";

const guest = (name: string, attending: boolean | null) => ({
  id: name,
  display_name: name,
  is_child: false,
  age: null,
  is_plus_one: false,
  source: "manual" as const,
  invited_event_ids: ["e"],
  attendance: attending === null ? [] : [{ event_id: "e", attending }],
});

const household = (id: string, tags: string[], guests: ReturnType<typeof guest>[]) => ({
  id,
  label: id,
  invited_note: null,
  tags,
  invite_code: null,
  guests,
  response: null,
});

const list: GuestList = {
  events: [],
  households: [
    household("h1", ["Rodina"], [guest("Žofie Malá", true), guest("Adam  Novák ", false)]),
    household("h2", ["Kolegové"], [guest("Bohumila Nováková-Procházková", null)]),
  ],
  unlisted: [
    {
      id: "u1",
      submitted_at: "2027-01-01T00:00:00Z",
      people: [
        {
          person_name: "Cyril Dvořák",
          is_child: false,
          age: null,
          attendance: [{ event_id: "e", attending: true }],
        },
        {
          person_name: "Eva Bílá",
          is_child: false,
          age: null,
          attendance: [{ event_id: "e", attending: false }],
        },
      ],
    },
  ],
};

describe("jména na jmenovky", () => {
  it("jen ti, kdo přijdou, včetně odpovědí mimo seznam, česky podle abecedy", () => {
    expect(nameCardNames(list, { audience: "attending", group: null })).toEqual([
      "Cyril Dvořák",
      "Žofie Malá",
    ]);
  });

  it("všichni pozvaní (bez ohledu na odpověď), mezery uklizené", () => {
    expect(nameCardNames(list, { audience: "all", group: null })).toEqual([
      "Adam Novák",
      "Bohumila Nováková-Procházková",
      "Cyril Dvořák",
      "Žofie Malá",
    ]);
  });

  it("skupina: jen její domácnosti, bez odpovědí mimo seznam", () => {
    expect(nameCardNames(list, { audience: "all", group: "Rodina" })).toEqual([
      "Adam Novák",
      "Žofie Malá",
    ]);
  });
});
