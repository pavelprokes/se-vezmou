import { describe, expect, it } from "vitest";
import {
  A4_MM,
  MARK,
  cardRects,
  cropMarks,
  fitName,
  foldMarks,
  gridRect,
  paginate,
  perSheet,
  splitName,
  nameCardFormats,
} from "./layout";

/** Hrubý odhad šířky: 0,5 em na znak, 1 pt = 0,3528 mm. */
const measure = (text: string, size: number) => text.length * size * 0.5 * 0.3528;

describe("rozložení na A4", () => {
  it("plochá 10 a stojánek 6 na list", () => {
    expect(perSheet("flat")).toBe(10);
    expect(perSheet("tent")).toBe(6);
  });

  it.each(nameCardFormats)(
    "%s: mřížka je na středu a značky se vejdou do tisknutelné plochy",
    (format) => {
      const grid = gridRect(format);
      expect(grid.x * 2 + grid.width).toBeCloseTo(A4_MM.width);
      expect(grid.y * 2 + grid.height).toBeCloseTo(A4_MM.height);
      // značky končí aspoň 5 mm od kraje listu (domácí tiskárny netisknou 3 až 5 mm)
      for (const mark of cropMarks(format)) {
        for (const x of [mark.x1, mark.x2])
          expect(Math.min(x, A4_MM.width - x)).toBeGreaterThanOrEqual(5);
        for (const y of [mark.y1, mark.y2])
          expect(Math.min(y, A4_MM.height - y)).toBeGreaterThanOrEqual(5);
      }
    },
  );

  it("karty se dotýkají bez mezer, takže každá linie je jeden řez", () => {
    const rects = cardRects("flat");
    expect(rects).toHaveLength(10);
    expect(rects[1].x).toBeCloseTo(rects[0].x + rects[0].width);
    expect(rects[2].y).toBeCloseTo(rects[0].y + rects[0].height);
  });

  it("ořezové značky: na každé linii řezu dvě, 3 mm od mřížky, 5 mm dlouhé", () => {
    const marks = cropMarks("flat");
    // 3 svislé linie × 2 + 6 vodorovných × 2
    expect(marks).toHaveLength(3 * 2 + 6 * 2);
    const grid = gridRect("flat");
    const topMark = marks[0];
    expect(topMark.y2).toBeCloseTo(grid.y - MARK.offset);
    expect(topMark.y2 - topMark.y1).toBeCloseTo(MARK.length);
  });

  it("značky přehybu jen u stojánku, v polovině výšky karty", () => {
    expect(foldMarks("flat")).toEqual([]);
    const marks = foldMarks("tent");
    expect(marks).toHaveLength(6);
    expect(marks[0].y1).toBeCloseTo(gridRect("tent").y + 45);
  });

  it("listy po deseti", () => {
    const pages = paginate(
      Array.from({ length: 23 }, (_, i) => i),
      "flat",
    );
    expect(pages.map((page) => page.length)).toEqual([10, 10, 3]);
  });
});

describe("velikost jména", () => {
  it("krátké jméno má největší velikost na jednom řádku", () => {
    expect(fitName("Klára Nová", 76, measure)).toEqual({ sizePt: 22, lines: ["Klára Nová"] });
  });

  it("delší jméno se zmenší, ale ne pod 14 pt na jednom řádku", () => {
    const fitted = fitName("Matěj Procházka", 50, measure);
    expect(fitted.lines).toHaveLength(1);
    expect(fitted.sizePt).toBeLessThan(22);
    expect(fitted.sizePt).toBeGreaterThanOrEqual(14);
  });

  it("velmi dlouhé jméno se zalomí na mezeře, příjmení zůstane celé", () => {
    const fitted = fitName("Bohumila Nováková-Procházková", 60, measure);
    expect(fitted.lines).toEqual(["Bohumila", "Nováková-Procházková"]);
    expect(fitted.sizePt).toBeGreaterThanOrEqual(6);
  });

  it("zlom na mezeře nejblíž středu; bez mezery za spojovníkem, který se opakuje", () => {
    expect(splitName("Jan Maria Novák Dvořák")).toEqual(["Jan Maria", "Novák Dvořák"]);
    expect(splitName("Nováková-Procházková")).toEqual(["Nováková-", "-Procházková"]);
    expect(splitName("Jednoslovné")).toEqual(["Jednoslovné"]);
  });

  it("nadbytečné mezery se sloučí", () => {
    expect(fitName("  Klára   Nová ", 76, measure).lines).toEqual(["Klára Nová"]);
  });
});
