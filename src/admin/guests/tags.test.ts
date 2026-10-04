import { describe, expect, it } from "vitest";
import { guestStats, hasTag, splitTags, tagsValid, weddingTags } from "./tags";

const guest = (attendance: { event_id: string; attending: boolean }[]) => ({
  id: "g",
  display_name: "Host",
  is_child: false,
  age: null,
  is_plus_one: false,
  source: "manual" as const,
  invited_event_ids: [],
  attendance,
});
const household = (tags: string[], guests: ReturnType<typeof guest>[]) => ({
  id: "h",
  label: "",
  invited_note: null,
  tags,
  guests,
  response: null,
});

describe("skupiny hostů", () => {
  it("rozdělí text na skupiny: ořez, mezery, bez prázdných a duplicit", () => {
    expect(splitTags("  Rodina   nevěsty , kolegové,,Kolegové ")).toEqual([
      "Rodina nevěsty",
      "kolegové",
    ]);
    expect(splitTags("")).toEqual([]);
  });

  it("hlídá meze databáze", () => {
    expect(tagsValid(["x".repeat(40)])).toBe(true);
    expect(tagsValid(["x".repeat(41)])).toBe(false);
    expect(tagsValid(Array.from({ length: 11 }, (_, i) => `t${i}`))).toBe(false);
  });

  it("seznam skupin svatby abecedně a bez ohledu na velikost písmen", () => {
    expect(
      weddingTags([{ tags: ["Kolegové", "Rodina"] }, { tags: ["kolegové", "Čtenáři"] }]),
    ).toEqual(["Čtenáři", "Kolegové", "Rodina"]);
    expect(hasTag({ tags: ["Kolegové"] }, "KOLEGOVÉ")).toBe(true);
  });

  it("počty hostů podle odpovědi", () => {
    const stats = guestStats([
      household(["A"], [guest([{ event_id: "e", attending: true }]), guest([])]),
      household(["A"], [guest([{ event_id: "e", attending: false }])]),
    ]);
    expect(stats).toEqual({ households: 2, guests: 3, attending: 1, declined: 1, noResponse: 1 });
  });
});
