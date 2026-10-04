import { describe, expect, it } from "vitest";
import { eventsForGuest, invitePath, inviteTarget } from "./invite";

const content = {
  locales: ["cs", "en"] as ("cs" | "en")[],
  defaultLocale: "cs" as const,
  blocks: [{ type: "rsvp", enabled: true, anchor: "odpoved" }] as never,
};

describe("osobní odkaz domácnosti", () => {
  it("cesta odkazu", () => {
    expect(invitePath("0123456789abcdef0123")).toBe("/p/0123456789abcdef0123");
  });

  it("přesměruje v jazyce hosta, když ho web nabízí, k formuláři RSVP", () => {
    expect(inviteTarget(content, "en", "cs")).toBe("/en#odpoved");
    expect(inviteTarget(content, null, "en")).toBe("/en#odpoved");
    expect(inviteTarget({ ...content, locales: ["cs"] }, "en", "en")).toBe("/#odpoved");
    expect(inviteTarget({ ...content, blocks: [] }, "cs", "cs")).toBe("/");
  });

  it("program bez událostí s potvrzováním, na které domácnost pozvaná není", () => {
    const events = [
      { id: "A", kind: "ceremony" as const, rsvpEnabled: true },
      { id: "b", kind: "reception" as const, rsvpEnabled: true },
      { id: "c", kind: "other" as const },
      { id: "d", kind: "reception" as const },
    ];
    expect(eventsForGuest(events, null)).toEqual(events);
    expect(eventsForGuest(events, ["a"]).map((e) => e.id)).toEqual(["A", "c"]);
  });
});
