import { describe, expect, it } from "vitest";
import {
  buildSpayd,
  czAccountToIban,
  isValidBic,
  isValidCzAccount,
  isValidIban,
  parseCzAccount,
  spaydMessage,
} from "./payment";

describe("QR platba (SPAYD)", () => {
  it("ověří IBAN kontrolním součtem", () => {
    expect(isValidIban("CZ6508000000192000145399")).toBe(true);
    expect(isValidIban("CZ65 0800 0000 1920 0014 5399")).toBe(true);
    expect(isValidIban("CZ6508000000192000145398")).toBe(false);
    expect(isValidIban("neplatny")).toBe(false);
  });

  it("ověří tvar BIC (8 nebo 11 znaků, mezery a malá písmena se tolerují)", () => {
    expect(isValidBic("GIBACZPX")).toBe(true);
    expect(isValidBic("gibaczpx xxx")).toBe(true);
    expect(isValidBic("GIBACZP")).toBe(false);
    expect(isValidBic("1234CZPX")).toBe(false);
  });

  it("zpráva je bez diakritiky, velkými písmeny a nejvýše 60 znaků", () => {
    expect(spaydMessage("Svatba Klára a Matěj")).toBe("SVATBA KLARA A MATEJ");
    expect(spaydMessage("a*b")).toBe("A B");
    expect(spaydMessage("x".repeat(100))).toHaveLength(60);
  });

  it("sestaví platbu bez pevné částky (žádná položka AM)", () => {
    const payload = buildSpayd({
      iban: "CZ65 0800 0000 1920 0014 5399",
      message: "Svatba Klára a Matěj",
    });
    expect(payload).toBe("SPD*1.0*ACC:CZ6508000000192000145399*CC:CZK*MSG:SVATBA KLARA A MATEJ");
    expect(payload).not.toContain("AM:");
  });

  it("zprávu vynechá, když chybí", () => {
    expect(buildSpayd({ iban: "CZ6508000000192000145399" })).toBe(
      "SPD*1.0*ACC:CZ6508000000192000145399*CC:CZK",
    );
  });
});

describe("tuzemské číslo účtu", () => {
  it("rozloží číslo účtu s předčíslím i bez něj a ověří kontrolní součty", () => {
    expect(parseCzAccount("19-2000145399/0800")).toEqual({
      prefix: "19",
      number: "2000145399",
      bank: "0800",
    });
    expect(parseCzAccount("2000145399 / 0800")).toEqual({
      prefix: "",
      number: "2000145399",
      bank: "0800",
    });
    expect(parseCzAccount("19-2000145398/0800")).toBeNull();
    expect(parseCzAccount("20-2000145399/0800")).toBeNull();
    expect(parseCzAccount("19-2000145399/800")).toBeNull();
    expect(isValidCzAccount("neplatne")).toBe(false);
  });

  it("odvodí IBAN s platnou kontrolní číslicí", () => {
    expect(czAccountToIban("19-2000145399/0800")).toBe("CZ6508000000192000145399");
    const iban = czAccountToIban("19-2000145399/0800");
    expect(iban && isValidIban(iban)).toBe(true);
    expect(czAccountToIban("123456789/0100")).toBeNull();
  });
});
