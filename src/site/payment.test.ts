import { describe, expect, it } from "vitest";
import { buildSpayd, isValidIban, spaydMessage } from "./payment";

describe("QR platba (SPAYD)", () => {
  it("ověří IBAN kontrolním součtem", () => {
    expect(isValidIban("CZ6508000000192000145399")).toBe(true);
    expect(isValidIban("CZ65 0800 0000 1920 0014 5399")).toBe(true);
    expect(isValidIban("CZ6508000000192000145398")).toBe(false);
    expect(isValidIban("neplatny")).toBe(false);
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
