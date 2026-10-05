import { describe, expect, it } from "vitest";
import { facePoint, fitDetail } from "./face";
import { parseNameCardOptions } from "./server";

const face = { width: 90, height: 45 };

describe("zadní strana stojánku", () => {
  it("přední strana jen posune bod o počátek", () => {
    expect(facePoint(face, { x: 15, y: 60 }, false, 10, 5)).toEqual({ x: 25, y: 65 });
  });

  it("otočení o 180°: střed zůstane, rohy se prohodí", () => {
    const origin = { x: 15, y: 15 };
    expect(facePoint(face, origin, true, 45, 22.5)).toEqual({ x: 60, y: 37.5 });
    expect(facePoint(face, origin, true, 0, 0)).toEqual({ x: 105, y: 60 });
    // účaří u spodní hrany přední strany je na zadní straně u horní hrany (u přehybu je dno písma)
    expect(facePoint(face, origin, true, 45, 40).y).toBeCloseTo(origin.y + 5);
  });
});

describe("drobný řádek", () => {
  const measure = (text: string, size: number) => text.length * size * 0.18;

  it("krátký zůstane v největší velikosti", () => {
    expect(fitDetail("Klára & Matěj", 76, measure)).toEqual({ text: "Klára & Matěj", sizePt: 7.5 });
  });

  it("dlouhý se zkrátí třemi tečkami na nejmenší velikosti", () => {
    const fitted = fitDetail("x".repeat(200), 76, measure);
    expect(fitted.sizePt).toBe(6);
    expect(fitted.text.endsWith("…")).toBe(true);
    expect(measure(fitted.text, 6)).toBeLessThanOrEqual(76);
  });
});

describe("volby z adresy a formuláře", () => {
  const parse = (values: Record<string, unknown>) => parseNameCardOptions((key) => values[key]);

  it("výchozí: kdo přijde, plochá, bez skupiny, s řádkem", () => {
    expect(parse({})).toEqual({ audience: "attending", format: "flat", group: null, detail: true });
  });

  it("neznámé hodnoty i pole padají na výchozí", () => {
    expect(parse({ kdo: "nekdo", format: ["stojanek"], skupina: "  ", radek: "x" })).toEqual({
      audience: "attending",
      format: "flat",
      group: null,
      detail: true,
    });
  });

  it("platné volby", () => {
    expect(parse({ kdo: "vsichni", format: "stojanek", skupina: " Rodina ", radek: "0" })).toEqual({
      audience: "all",
      format: "tent",
      group: "Rodina",
      detail: false,
    });
  });
});
