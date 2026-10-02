import { describe, expect, it } from "vitest";
import {
  coupleNames,
  formatDay,
  formatMoment,
  formatMonth,
  isIsoDay,
  pragueDayStart,
} from "./format";

const plain = (value: string) => value.replace(/\s/g, " ");

describe("formátování administrace", () => {
  it("datum bez času se nikdy neposune na sousední den", () => {
    expect(plain(formatDay("2027-06-12", "-"))).toBe("12. 6. 2027");
    expect(plain(formatDay("2027-01-01", "-"))).toBe("1. 1. 2027");
  });

  it("okamžik se ukáže v pražském čase (léto UTC+2, zima UTC+1)", () => {
    expect(plain(formatMoment("2026-10-02T12:05:00Z", "-"))).toBe("2. 10. 2026 14:05");
    expect(plain(formatMoment("2026-01-15T12:05:00Z", "-"))).toBe("15. 1. 2026 13:05");
  });

  it("chybějící hodnota dá náhradní text", () => {
    expect(formatDay(null, "neuvedeno")).toBe("neuvedeno");
    expect(formatMoment(undefined, "neuvedeno")).toBe("neuvedeno");
  });

  it("měsíc a jména páru", () => {
    expect(plain(formatMonth("2027-06"))).toBe("červen 2027");
    expect(coupleNames("Klára", "Matěj")).toBe("Klára a Matěj");
  });

  it("isIsoDay odmítne neexistující dny a špatný tvar", () => {
    expect(isIsoDay("2027-06-12")).toBe(true);
    expect(isIsoDay("2027-02-30")).toBe(false);
    expect(isIsoDay("2027-6-1")).toBe(false);
    expect(isIsoDay("")).toBe(false);
    expect(isIsoDay("jednou")).toBe(false);
  });

  it("začátek dne v Praze: v létě o dvě hodiny dřív než půlnoc UTC, v zimě o jednu", () => {
    expect(pragueDayStart("2026-07-15").toISOString()).toBe("2026-07-14T22:00:00.000Z");
    expect(pragueDayStart("2026-01-15").toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });
});
