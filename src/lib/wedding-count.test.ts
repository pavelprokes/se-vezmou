// Kompatibilní s Vitest i Jest. Uprav import podle test runneru v projektu.
import { describe, expect, it } from "vitest";
import { acceleratedTime, weddingsSinceNewYear } from "./wedding-count";

const YEARLY = 42_500;

describe("weddingsSinceNewYear", () => {
  it("je 0 na začátku roku", () => {
    expect(weddingsSinceNewYear(new Date(2027, 0, 1, 0, 0, 0).getTime(), YEARLY)).toBe(0);
  });

  it("je zhruba polovina v polovině roku", () => {
    const n = weddingsSinceNewYear(new Date(2027, 6, 2, 12, 0, 0).getTime(), YEARLY);
    expect(n).toBeGreaterThan(21_000);
    expect(n).toBeLessThan(21_500);
  });

  it("jedna svatba přibude zhruba za 12,4 minuty", () => {
    const t0 = new Date(2027, 2, 10, 12, 0, 0).getTime();
    const diff = weddingsSinceNewYear(t0 + 25 * 60_000, YEARLY) - weddingsSinceNewYear(t0, YEARLY);
    expect([1, 2, 3]).toContain(diff);
  });

  it("po půlnoci 1. ledna se vynuluje", () => {
    const before = weddingsSinceNewYear(new Date(2026, 11, 31, 23, 59, 59).getTime(), YEARLY);
    const after = weddingsSinceNewYear(new Date(2027, 0, 1, 0, 0, 1).getTime(), YEARLY);
    expect(before).toBeGreaterThan(42_000);
    expect(after).toBe(0);
  });

  it("nikdy nepřekročí roční počet", () => {
    expect(
      weddingsSinceNewYear(new Date(2028, 11, 31, 23, 59, 59).getTime(), YEARLY),
    ).toBeLessThanOrEqual(YEARLY);
  });
});

describe("acceleratedTime", () => {
  it("speed 1 je reálný čas", () => {
    expect(acceleratedTime(1000, 6000, 1)).toBe(6000);
  });
  it("speed 60 posouvá čas 60x rychleji", () => {
    expect(acceleratedTime(0, 1000, 60)).toBe(60_000);
  });
});
