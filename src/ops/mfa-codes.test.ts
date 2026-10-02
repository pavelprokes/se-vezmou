import { describe, expect, it } from "vitest";
import {
  BACKUP_CODE_COUNT,
  formatBackupCode,
  generateBackupCodes,
  hashBackupCode,
  normalizeBackupCode,
} from "./backup-codes";
import { decryptTotpSecret, encryptTotpSecret } from "./mfa-secret";
import { can, OPERATOR_ACTIONS } from "./roles";

const KEY = "operator-test-key-operator-test-key-0001";
const OPERATOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("záložní kódy", () => {
  it("vygeneruje deset různých kódů ve tvaru ABCDE-FGHJK bez zaměnitelných znaků", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(BACKUP_CODE_COUNT);
    expect(new Set(codes).size).toBe(BACKUP_CODE_COUNT);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    }
  });

  it("dvě sady se neshodují", () => {
    expect(generateBackupCodes()).not.toEqual(generateBackupCodes());
  });

  it("normalizace odpustí velikost písmen, mezery a spojovníky, jinak odmítne", () => {
    expect(normalizeBackupCode("abcde-fghjk")).toBe("ABCDEFGHJK");
    expect(normalizeBackupCode(" ABCDE FGHJK ")).toBe("ABCDEFGHJK");
    expect(normalizeBackupCode("ABCDEFGHJK")).toBe("ABCDEFGHJK");
    expect(normalizeBackupCode("ABCDE-FGHJ")).toBeNull();
    expect(normalizeBackupCode("ABCDE-FGHJ0")).toBeNull();
    expect(normalizeBackupCode("ABCDE-FGHJI")).toBeNull();
    expect(normalizeBackupCode("123456")).toBeNull();
    expect(normalizeBackupCode(null)).toBeNull();
  });

  it("formát a normalizace jsou si inverzní", () => {
    expect(normalizeBackupCode(formatBackupCode("ABCDEFGHJK"))).toBe("ABCDEFGHJK");
  });

  it("hash je HMAC svázaný s operátorem a klíčem", () => {
    const hash = hashBackupCode(KEY, OPERATOR, "ABCDEFGHJK");
    expect(hash).toHaveLength(32);
    expect(hashBackupCode(KEY, OPERATOR, "ABCDEFGHJK").equals(hash)).toBe(true);
    expect(hashBackupCode(KEY, OTHER, "ABCDEFGHJK").equals(hash)).toBe(false);
    expect(hashBackupCode(KEY, OPERATOR, "ABCDEFGHJL").equals(hash)).toBe(false);
    expect(hashBackupCode(`${KEY}x`, OPERATOR, "ABCDEFGHJK").equals(hash)).toBe(false);
    expect(hash.toString("utf8")).not.toContain("ABCDEFGHJK");
  });

  it("příliš krátký klíč se odmítne", () => {
    expect(() => hashBackupCode("krátký", OPERATOR, "ABCDEFGHJK")).toThrow();
  });
});

describe("šifrování tajného klíče TOTP", () => {
  const secret = "JBSWY3DPEHPK3PXP";

  it("obousměrně projde a šifrový text klíč neobsahuje", () => {
    const encrypted = encryptTotpSecret(KEY, OPERATOR, secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptTotpSecret(KEY, OPERATOR, encrypted)).toBe(secret);
  });

  it("jiný klíč, jiný operátor nebo poškození vrátí null", () => {
    const encrypted = encryptTotpSecret(KEY, OPERATOR, secret);
    expect(decryptTotpSecret(`${KEY}x`, OPERATOR, encrypted)).toBeNull();
    expect(decryptTotpSecret(KEY, OTHER, encrypted)).toBeNull();
    expect(decryptTotpSecret(KEY, OPERATOR, `${encrypted.slice(0, -2)}AA`)).toBeNull();
    expect(decryptTotpSecret(KEY, OPERATOR, "")).toBeNull();
  });

  it("dvakrát zašifrovaný stejný klíč dá jiný šifrový text (náhodný IV)", () => {
    expect(encryptTotpSecret(KEY, OPERATOR, secret)).not.toBe(
      encryptTotpSecret(KEY, OPERATOR, secret),
    );
  });
});

describe("role operátorů", () => {
  it("majitel smí všechno", () => {
    for (const action of OPERATOR_ACTIONS) expect(can("owner", action)).toBe(true);
  });

  it("podpora smí číst, psát poznámky, posílat odkaz, nahlížet se souhlasem a blokovat", () => {
    for (const action of ["view", "note", "login_link", "guest_data", "block"] as const) {
      expect(can("support", action)).toBe(true);
    }
  });

  it("podpora nesmí ostatní zásahy, audit ani správu operátorů", () => {
    for (const action of [
      "set_status",
      "change_slug",
      "extend_retention",
      "restore",
      "audit",
      "manage_operators",
    ] as const) {
      expect(can("support", action)).toBe(false);
    }
  });
});
