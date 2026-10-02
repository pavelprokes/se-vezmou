import { describe, expect, it } from "vitest";
import { mergeOutcomes, rateKey } from "./rate-limit";

const SECRET = "tajna-hodnota-tajna-hodnota-tajna-hodnota";

describe("rateKey", () => {
  it("je deterministický, nese scope a neobsahuje surovou hodnotu", () => {
    const key = rateKey(SECRET, "login-request-ip", "203.0.113.7");
    expect(key).toBe(rateKey(SECRET, "login-request-ip", "203.0.113.7"));
    expect(key.startsWith("login-request-ip:")).toBe(true);
    expect(key).not.toContain("203.0.113.7");
  });

  it("různé scope, hodnoty a tajné hodnoty dávají různé klíče", () => {
    const base = rateKey(SECRET, "a", "x");
    expect(rateKey(SECRET, "b", "x")).not.toBe(base);
    expect(rateKey(SECRET, "a", "y")).not.toBe(base);
    expect(rateKey("jina-hodnota-jina-hodnota-jina-hodnota-1", "a", "x")).not.toBe(base);
  });

  it("se vejde do omezení sloupce bucket_key (200 znaků) i pro dlouhý vstup", () => {
    expect(rateKey(SECRET, "login-request-email", "x".repeat(5000)).length).toBeLessThan(200);
  });

  it("odmítne krátkou tajnou hodnotu", () => {
    expect(() => rateKey("krátké", "a", "x")).toThrow();
  });
});

describe("mergeOutcomes", () => {
  it("povolí jen když projdou všechna pravidla a vezme nejdelší čekání", () => {
    expect(
      mergeOutcomes([
        { allowed: true, retryAfter: 0 },
        { allowed: false, retryAfter: 30 },
        { allowed: false, retryAfter: 90 },
      ]),
    ).toEqual({ allowed: false, retryAfter: 90 });
    expect(mergeOutcomes([{ allowed: true, retryAfter: 0 }])).toEqual({
      allowed: true,
      retryAfter: 0,
    });
    expect(mergeOutcomes([])).toEqual({ allowed: true, retryAfter: 0 });
  });
});
