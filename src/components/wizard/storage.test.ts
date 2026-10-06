// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createDraft, type WizardDraft } from "@/wizard/draft";
import { DRAFT_KEY, readStoredDraft, writeStoredDraft } from "./storage";

const PIN = "482915";

function draftWithPin(): WizardDraft {
  const draft = createDraft({ locale: "cs", partnerA: "Klára", partnerB: "Matěj" });
  return { ...draft, guestPin: { enabled: true, pin: PIN } };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("koncept průvodce v úložišti prohlížeče (OQ-64)", () => {
  it("serializovaný koncept v localStorage neobsahuje PIN hostů", () => {
    expect(writeStoredDraft(draftWithPin())).toBe(true);
    const raw = window.localStorage.getItem(DRAFT_KEY) ?? "";
    expect(raw).not.toContain(PIN);
    expect(JSON.parse(raw).guestPin).toEqual({ enabled: true, pin: "" });
  });

  it("záložní sessionStorage PIN také nedostane", () => {
    const proto = Object.getPrototypeOf(window.localStorage) as Storage;
    const original = proto.setItem;
    proto.setItem = function (this: Storage, key: string, value: string) {
      if (this === window.localStorage) throw new Error("quota");
      return original.call(this, key, value);
    };
    try {
      expect(writeStoredDraft(draftWithPin())).toBe(false);
    } finally {
      proto.setItem = original;
    }
    expect(window.sessionStorage.getItem(DRAFT_KEY) ?? "").not.toContain(PIN);
  });

  it("záznam aktuální verze s podstrčeným PINem se při čtení očistí", () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draftWithPin()));
    expect(readStoredDraft()?.guestPin).toEqual({ enabled: true, pin: "" });
    expect(window.localStorage.getItem(DRAFT_KEY) ?? "").not.toContain(PIN);
  });

  it("starý záznam verze 1 s PINem se při čtení očistí a přepíše v úložišti", () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draftWithPin(), version: 1 }));
    const restored = readStoredDraft();
    expect(restored?.version).toBe(2);
    expect(restored?.guestPin).toEqual({ enabled: true, pin: "" });
    const raw = window.localStorage.getItem(DRAFT_KEY) ?? "";
    expect(raw).not.toContain(PIN);
    expect(JSON.parse(raw).version).toBe(2);
  });
});
