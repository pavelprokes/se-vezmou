import { describe, expect, it } from "vitest";
import { codeHash, emailDomain, emailHash, normalizeEmail, parseCode, parseSlug } from "./identity";

const SECRET = "tajna-hodnota-tajna-hodnota-tajna-hodnota";

describe("normalizeEmail", () => {
  it("ořízne mezery a převede na malá písmena", () => {
    expect(normalizeEmail("  Klara@Example.CZ ")).toBe("klara@example.cz");
  });

  it.each(["", "klara", "klara@", "@example.cz", "kl ara@example.cz", `${"a".repeat(250)}@b.cz`])(
    "%j není e-mail",
    (value) => {
      expect(normalizeEmail(value)).toBeNull();
    },
  );

  it("neřetězec je null", () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
});

describe("emailDomain", () => {
  it("vrací doménu malými písmeny", () => {
    expect(emailDomain("klara@Example.cz")).toBe("example.cz");
  });
});

describe("emailHash a codeHash", () => {
  it("jsou 32 bajtů, deterministické a nenesou e-mail ani kód", () => {
    const hash = emailHash(SECRET, "klara@example.cz");
    expect(hash).toHaveLength(32);
    expect(hash.equals(emailHash(SECRET, "klara@example.cz"))).toBe(true);
    expect(hash.toString("utf8")).not.toContain("klara");
  });

  it("hash kódu závisí na e-mailu i kódu (kód jedné osoby neplatí u druhé)", () => {
    const a = codeHash(SECRET, "klara@example.cz", "123456");
    expect(a.equals(codeHash(SECRET, "klara@example.cz", "123456"))).toBe(true);
    expect(a.equals(codeHash(SECRET, "matej@example.cz", "123456"))).toBe(false);
    expect(a.equals(codeHash(SECRET, "klara@example.cz", "123457"))).toBe(false);
  });

  it("hash e-mailu a hash kódu jsou oddělené účely", () => {
    expect(emailHash(SECRET, "a@b.cz").equals(codeHash(SECRET, "a@b.cz", ""))).toBe(false);
  });
});

describe("parseCode", () => {
  it("přijme šest číslic, i s mezerou nebo spojovníkem", () => {
    expect(parseCode("012345")).toBe("012345");
    expect(parseCode(" 123 456 ")).toBe("123456");
    expect(parseCode("123-456")).toBe("123456");
  });

  it.each(["12345", "1234567", "12345a", "", "abcdef"])("%j není kód", (value) => {
    expect(parseCode(value)).toBeNull();
  });

  it("neřetězec je null", () => {
    expect(parseCode(null)).toBeNull();
    expect(parseCode(123456)).toBeNull();
  });
});

describe("parseSlug", () => {
  it("vrátí slug i z celé adresy webu", () => {
    expect(parseSlug("klara-a-matej")).toBe("klara-a-matej");
    expect(parseSlug(" Klara-A-Matej ")).toBe("klara-a-matej");
    expect(parseSlug("klara-a-matej.se-vezmou.cz")).toBe("klara-a-matej");
    expect(parseSlug("https://klara-a-matej.se-vezmou.cz/")).toBe("klara-a-matej");
    expect(parseSlug("http://klara-a-matej.localhost:3000/cesta")).toBe("klara-a-matej");
  });

  it.each(["", "-a", "a-", "a--b", "špatně", "a b", ".cz", "a_b"])("%j není slug", (value) => {
    expect(parseSlug(value)).toBeNull();
  });

  it("neřetězec je null", () => {
    expect(parseSlug(undefined)).toBeNull();
  });
});
