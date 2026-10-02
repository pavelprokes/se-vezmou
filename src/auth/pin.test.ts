import { describe, expect, it } from "vitest";
import { getDummyHash, hashPin, normalizePinInput, pinProblem, verifyPin } from "./pin";

const PEPPER = "pepper-pepper-pepper-pepper-pepper-0001";
const OTHER_PEPPER = "pepper-pepper-pepper-pepper-pepper-0002";

describe("pinProblem", () => {
  it.each(["482915", "739104", "8203916", "100203"])("%s je přijatelný PIN", (pin) => {
    expect(pinProblem(pin)).toBeNull();
  });

  it.each(["12345", "", "abcdef", "12 3456", "1234567890123"])("%j má špatný tvar", (pin) => {
    expect(pinProblem(pin)).toBe("format");
  });

  it.each(["000000", "111111", "123456", "654321", "1234567", "99999999"])(
    "%s je triviální",
    (pin) => {
      expect(pinProblem(pin)).toBe("trivial");
    },
  );

  it("PIN o šesti číslicích je nejkratší povolený", () => {
    expect(pinProblem("482915")).toBeNull();
    expect(pinProblem("48291")).toBe("format");
  });
});

describe("normalizePinInput", () => {
  it("odstraní mezery a spojovníky z opsaného PINu", () => {
    expect(normalizePinInput(" 482 915 ")).toBe("482915");
    expect(normalizePinInput("482-915")).toBe("482915");
  });
});

describe("hash PINu (argon2id + pepper)", () => {
  it("je argon2id s parametry OWASP", async () => {
    const hash = await hashPin("482915", PEPPER);
    expect(hash.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
  });

  it("neobsahuje PIN a při každém hashování používá jinou sůl", async () => {
    const a = await hashPin("482915", PEPPER);
    const b = await hashPin("482915", PEPPER);
    expect(a).not.toContain("482915");
    expect(a).not.toBe(b);
  });

  it("ověří správný PIN a odmítne jiný", async () => {
    const hash = await hashPin("482915", PEPPER);
    expect(await verifyPin(hash, "482915", PEPPER)).toBe(true);
    expect(await verifyPin(hash, "482916", PEPPER)).toBe(false);
    expect(await verifyPin(hash, "", PEPPER)).toBe(false);
  });

  it("bez správného peppera PIN neověří (pepper je mimo databázi)", async () => {
    const hash = await hashPin("482915", PEPPER);
    expect(await verifyPin(hash, "482915", OTHER_PEPPER)).toBe(false);
  });

  it("příliš krátký pepper se odmítne", async () => {
    await expect(hashPin("482915", "krátký")).rejects.toThrow();
  });

  it("poškozený hash je neshoda, ne výjimka", async () => {
    expect(await verifyPin("hash-admin-A", "482915", PEPPER)).toBe(false);
    expect(await verifyPin("", "482915", PEPPER)).toBe(false);
  });

  it("hash PINu správy se neshoduje s hashem stejného PINu hostů, ale ověřením jde odhalit shodu", async () => {
    // Aplikace porovnává nový PIN s hashem druhé role přes verifyPin (hash je solený).
    const adminHash = await hashPin("482915", PEPPER);
    expect(await verifyPin(adminHash, "482915", PEPPER)).toBe(true);
    expect(await verifyPin(adminHash, "739104", PEPPER)).toBe(false);
  });

  it("falešný hash pro vyrovnání času je platný argon2id a nic neověří", async () => {
    const dummy = await getDummyHash(PEPPER);
    expect(dummy.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPin(dummy, "482915", PEPPER)).toBe(false);
  });
});
