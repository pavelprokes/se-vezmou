import { describe, expect, it } from "vitest";
import {
  assertSecret,
  generateCode,
  generateToken,
  hashToken,
  hmac,
  safeEqual,
  seal,
  unseal,
} from "./crypto";

const SECRET = "tajna-hodnota-tajna-hodnota-tajna-hodnota";
const OTHER = "jina-hodnota-jina-hodnota-jina-hodnota-1";

describe("token relace", () => {
  it("má 32 bajtů v base64url (43 znaků) a je pokaždé jiný", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("do databáze jde SHA-256 (32 bajtů), ne token", () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).toHaveLength(32);
    expect(hash.equals(hashToken(token))).toBe(true);
    expect(hash.toString("utf8")).not.toContain(token);
    expect(hashToken(generateToken()).equals(hash)).toBe(false);
  });
});

describe("generateCode", () => {
  it("vrací šest číslic včetně úvodních nul", () => {
    const codes = Array.from({ length: 2000 }, () => generateCode());
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(codes.some((c) => c.startsWith("0"))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(1900);
  });
});

describe("safeEqual", () => {
  it("porovnává obsah a různou délku bere jako nerovnost", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual(Buffer.from("ab"), "ab")).toBe(true);
  });
});

describe("hmac", () => {
  it("je deterministický a závisí na tajné hodnotě i účelu", () => {
    expect(hmac(SECRET, "a", "x").equals(hmac(SECRET, "a", "x"))).toBe(true);
    expect(hmac(SECRET, "a", "x").equals(hmac(OTHER, "a", "x"))).toBe(false);
    expect(hmac(SECRET, "a", "x").equals(hmac(SECRET, "b", "x"))).toBe(false);
    expect(hmac(SECRET, "a", "x")).toHaveLength(32);
  });

  it("účel a hodnota nejdou zaměnit přesunem oddělovače", () => {
    expect(hmac(SECRET, "ab", "c").equals(hmac(SECRET, "a", "bc"))).toBe(false);
  });

  it("odmítne krátkou tajnou hodnotu", () => {
    expect(() => hmac("krátké", "a", "x")).toThrow(/32/);
    expect(() => assertSecret("")).toThrow();
  });
});

describe("seal a unseal", () => {
  const payload = { e: "klara@example.cz", c: "012345", x: 1_800_000_000_000 };

  it("vrátí původní data a v řetězci není nic čitelného", () => {
    const token = seal(SECRET, "login-link", payload);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("klara");
    expect(token).not.toContain("012345");
    expect(unseal(SECRET, "login-link", token)).toEqual(payload);
  });

  it("dvě zapečetění stejných dat se liší (náhodný IV)", () => {
    expect(seal(SECRET, "p", payload)).not.toBe(seal(SECRET, "p", payload));
  });

  it("jiný účel, jiná tajná hodnota nebo úprava tokenu vrátí null", () => {
    const token = seal(SECRET, "login-link", payload);
    expect(unseal(SECRET, "login-pending", token)).toBeNull();
    expect(unseal(OTHER, "login-link", token)).toBeNull();
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect(unseal(SECRET, "login-link", tampered)).toBeNull();
    expect(unseal(SECRET, "login-link", "")).toBeNull();
    expect(unseal(SECRET, "login-link", "nesmysl")).toBeNull();
  });
});
