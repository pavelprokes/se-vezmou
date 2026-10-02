import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  groupSecret,
  hotp,
  otpauthUri,
  parseTotpCode,
  timeStep,
  totpAt,
  verifyTotp,
} from "./totp";

/** Tajný klíč z RFC 6238 (příloha B, SHA-1): ASCII "12345678901234567890". */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("base32", () => {
  it("odpovídá vektorům z RFC 4648", () => {
    const vectors: [string, string][] = [
      ["", ""],
      ["f", "MY"],
      ["fo", "MZXQ"],
      ["foo", "MZXW6"],
      ["foob", "MZXW6YQ"],
      ["fooba", "MZXW6YTB"],
      ["foobar", "MZXW6YTBOI"],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain, "ascii"))).toBe(encoded);
      if (plain) expect(base32Decode(encoded)?.toString("ascii")).toBe(plain);
    }
  });

  it("odpustí malá písmena, mezery, spojovníky a doplněk", () => {
    expect(base32Decode("mzxw 6ytb-oi======")?.toString("ascii")).toBe("foobar");
  });

  it("odmítne neplatné znaky a prázdný vstup", () => {
    expect(base32Decode("MZXW1")).toBeNull();
    expect(base32Decode("")).toBeNull();
    expect(base32Decode("  - ")).toBeNull();
  });

  it("nově vygenerovaný klíč má 32 znaků base32 a nikdy se neopakuje", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(a)).toHaveLength(20);
    expect(a).not.toBe(b);
  });
});

describe("hotp (RFC 4226, příloha D)", () => {
  it("vydá očekávané kódy pro čítače 0 až 9", () => {
    const secret = Buffer.from("12345678901234567890", "ascii");
    const expected = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    expected.forEach((code, counter) => expect(hotp(secret, counter)).toBe(code));
  });
});

describe("totp (RFC 6238, příloha B, SHA-1, posledních šest číslic)", () => {
  const vectors: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];

  it.each(vectors)("v čase %i je kód %s", (seconds, code) => {
    expect(totpAt(RFC_SECRET, seconds * 1000)).toBe(code);
  });

  it("časový krok se mění po 30 sekundách", () => {
    expect(timeStep(29_999)).toBe(0);
    expect(timeStep(30_000)).toBe(1);
    expect(timeStep(59_999)).toBe(1);
  });
});

describe("verifyTotp", () => {
  const now = 1_700_000_000_000;
  const step = timeStep(now);
  const code = (offset: number) => totpAt(RFC_SECRET, now + offset * 30_000);

  it("přijme kód aktuálního kroku a vrátí jeho číslo", () => {
    expect(verifyTotp(RFC_SECRET, code(0), now, null)).toBe(step);
  });

  it("toleruje jeden krok před i po (posun hodin)", () => {
    expect(verifyTotp(RFC_SECRET, code(-1), now, null)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, code(1), now, null)).toBe(step + 1);
  });

  it("odmítne kód mimo okno", () => {
    expect(verifyTotp(RFC_SECRET, code(-2), now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code(2), now, null)).toBeNull();
  });

  it("odmítne už použitý krok i starší (kód jde použít jednou)", () => {
    expect(verifyTotp(RFC_SECRET, code(0), now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code(-1), now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code(1), now, step)).toBe(step + 1);
  });

  it("odmítne špatný tvar a špatný klíč", () => {
    expect(verifyTotp(RFC_SECRET, "12345", now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "", now, null)).toBeNull();
    expect(verifyTotp("11111111", code(0), now, null)).toBeNull();
    expect(verifyTotp(generateTotpSecret(), code(0), now, null)).toBeNull();
  });

  it("nespadne na začátku epochy (záporný krok)", () => {
    expect(verifyTotp(RFC_SECRET, "000000", 0, null)).toBeNull();
  });
});

describe("parseTotpCode", () => {
  it("přijme šest číslic, i s mezerou nebo spojovníkem uprostřed (vložení ze schránky)", () => {
    expect(parseTotpCode("123456")).toBe("123456");
    expect(parseTotpCode(" 123 456 ")).toBe("123456");
    expect(parseTotpCode("123-456")).toBe("123456");
  });

  it("odmítne jiný tvar", () => {
    expect(parseTotpCode("12345")).toBeNull();
    expect(parseTotpCode("1234567")).toBeNull();
    expect(parseTotpCode("12345a")).toBeNull();
    expect(parseTotpCode(undefined)).toBeNull();
    expect(parseTotpCode(123456)).toBeNull();
  });
});

describe("otpauthUri a groupSecret", () => {
  it("sestaví adresu pro aplikace TOTP", () => {
    const uri = otpauthUri({
      issuer: "Se vezmou (provoz)",
      account: "majitel@example.cz",
      secret: "JBSWY3DPEHPK3PXP",
    });
    const url = new URL(uri);
    expect(url.protocol).toBe("otpauth:");
    expect(url.host).toBe("totp");
    expect(decodeURIComponent(url.pathname)).toBe("/Se vezmou (provoz):majitel@example.cz");
    expect(url.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(url.searchParams.get("issuer")).toBe("Se vezmou (provoz)");
    expect(url.searchParams.get("digits")).toBe("6");
    expect(url.searchParams.get("period")).toBe("30");
    expect(url.searchParams.get("algorithm")).toBe("SHA1");
  });

  it("klíč po čtyřech znacích jde zpět vložit do dekódování", () => {
    const grouped = groupSecret("JBSWY3DPEHPK3PXP");
    expect(grouped).toBe("JBSW Y3DP EHPK 3PXP");
    expect(base32Decode(grouped)).toEqual(base32Decode("JBSWY3DPEHPK3PXP"));
  });
});
