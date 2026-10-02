import { describe, expect, it } from "vitest";
import {
  ADMIN_SESSION,
  LOGIN_CODE,
  PIN_LENGTH,
  PIN_LOCKOUT,
  RATE_RULES,
  pauseSeconds,
} from "./config";

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

describe("lhůty", () => {
  it("relace správce: nečinnost 14 dní, absolutně 60 dní", () => {
    expect(ADMIN_SESSION.idleSeconds).toBe(14 * DAY);
    expect(ADMIN_SESSION.absoluteSeconds).toBe(60 * DAY);
    expect(ADMIN_SESSION.absoluteSeconds).toBeGreaterThan(ADMIN_SESSION.idleSeconds);
  });

  it("kód: šest číslic, platnost 10 minut, pět pokusů", () => {
    expect(LOGIN_CODE).toEqual({ ttlSeconds: 10 * MINUTE, length: 6, maxAttempts: 5 });
  });

  it("PIN má nejméně šest číslic", () => {
    expect(PIN_LENGTH.min).toBe(6);
  });
});

describe("pauza po chybách PINu", () => {
  it("pět chyb, pauza 15 minut, strop 24 hodin", () => {
    expect(PIN_LOCKOUT).toEqual({ threshold: 5, baseSeconds: 15 * MINUTE, maxSeconds: DAY });
  });

  it("každá další série pauzu zdvojnásobí", () => {
    expect([1, 2, 3, 4, 5].map((level) => pauseSeconds(level))).toEqual([
      15 * MINUTE,
      30 * MINUTE,
      60 * MINUTE,
      2 * HOUR,
      4 * HOUR,
    ]);
  });

  it("pauza nikdy nepřekročí 24 hodin", () => {
    expect(pauseSeconds(7)).toBe(16 * HOUR);
    expect(pauseSeconds(8)).toBe(DAY);
    expect(pauseSeconds(9)).toBe(DAY);
    expect(pauseSeconds(1000)).toBe(DAY);
  });

  it("úroveň 0 nebo neplatná znamená bez pauzy", () => {
    expect(pauseSeconds(0)).toBe(0);
    expect(pauseSeconds(-1)).toBe(0);
    expect(pauseSeconds(1.5)).toBe(0);
  });
});

describe("limity (ADR 0010)", () => {
  it("odpovídají tabulce v ADR", () => {
    expect(RATE_RULES.loginRequestEmail).toEqual({ limit: 5, windowSeconds: HOUR });
    expect(RATE_RULES.loginRequestIp).toEqual({ limit: 20, windowSeconds: HOUR });
    expect(RATE_RULES.loginVerifyIp).toEqual({ limit: 30, windowSeconds: HOUR });
    expect(RATE_RULES.pinAdminIp).toEqual({ limit: 20, windowSeconds: HOUR });
    expect(RATE_RULES.pinGuestWeddingFailures).toEqual({ limit: 50, windowSeconds: HOUR });
  });
});
