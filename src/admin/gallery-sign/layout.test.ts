import { describe, expect, it } from "vitest";
import { PT_TO_MM } from "@/admin/name-cards/face";
import { cardStyle } from "@/admin/name-cards/style";
import { signCopy } from "./copy";
import {
  gallerySignFormats,
  signCropMarks,
  signLayout,
  signPage,
  signRects,
  wrapFit,
  type SignContent,
  type SignMeasure,
} from "./layout";

// Přibližná metrika: průměrný znak má polovinu velikosti písma (stačí na kontrolu rozvržení).
const measure: SignMeasure = (text, _font, sizePt) => text.length * sizePt * 0.5 * PT_TO_MM;
const style = cardStyle("eukalyptus", "");

function content(secondary: boolean, couple = "Klára & Matěj"): SignContent {
  const cs = signCopy("cs", "upload", true);
  const en = signCopy("en", "upload", true);
  return {
    couple,
    heading: cs.heading,
    instruction: cs.instruction,
    secondary: secondary ? en : null,
    url: "photos.svatebni-fotograf-cechy.cz/s/abcDEF123abcDEF123/klara-a-matej",
  };
}

describe("signLayout", () => {
  for (const format of gallerySignFormats) {
    for (const bilingual of [false, true]) {
      it(`${format}${bilingual ? " dvojjazyčně" : ""}: vše uvnitř cedulky, QR dost velký`, () => {
        const layout = signLayout(format, content(bilingual), style, measure);
        for (const line of layout.texts) {
          const half = measure(line.text, line.font, line.sizePt) / 2;
          expect(line.x - half).toBeGreaterThanOrEqual(0);
          expect(line.x + half).toBeLessThanOrEqual(layout.width);
          expect(line.y).toBeLessThanOrEqual(layout.height - 3);
          expect(line.y).toBeGreaterThan(0);
        }
        expect(layout.qr.size).toBeGreaterThanOrEqual(50);
        expect(layout.qr.x).toBeGreaterThan(0);
        expect(layout.qr.x + layout.qr.size).toBeLessThan(layout.width);
        // QR nepřekrývá text
        for (const line of layout.texts) {
          const inside = line.y > layout.qr.y && line.y - 1 < layout.qr.y + layout.qr.size;
          expect(inside).toBe(false);
        }
      });
    }
  }

  it("dlouhá jména páru se zmenší nebo zkrátí, nepřetečou", () => {
    const layout = signLayout(
      "frame",
      content(true, "Anna-Marie Dvořáková Nováková & Maximilián Jindřich z Lobkowicz"),
      style,
      measure,
    );
    const kicker = layout.texts[0];
    expect(measure(kicker.text, kicker.font, kicker.sizePt)).toBeLessThanOrEqual(layout.width - 18);
  });

  it("jména jsou verzálkami a v barvě akcentu", () => {
    const layout = signLayout("frame", content(false), style, measure);
    expect(layout.texts[0]).toMatchObject({ text: "KLÁRA & MATĚJ", tone: "accent" });
  });
});

describe("wrapFit", () => {
  it("nezlomitelná mezera drží slova pohromadě", () => {
    const fitted = wrapFit("a v lese", "sans", 3, { max: 10, min: 10 }, 5, measure);
    expect(fitted.lines).toContain("v lese");
  });
});

describe("arch A4", () => {
  for (const format of gallerySignFormats) {
    it(`${format}: cedulky drží aspoň 13 mm od kraje a mají ořezové značky`, () => {
      const page = signPage(format);
      for (const rect of signRects(format)) {
        expect(rect.x).toBeGreaterThanOrEqual(13);
        expect(rect.y).toBeGreaterThanOrEqual(13);
        expect(page.width - rect.x - rect.width).toBeGreaterThanOrEqual(13);
        expect(page.height - rect.y - rect.height).toBeGreaterThanOrEqual(13);
      }
      const marks = signCropMarks(format);
      expect(marks.length).toBeGreaterThan(0);
      for (const mark of marks) {
        expect(Math.min(mark.x1, mark.x2)).toBeGreaterThanOrEqual(0);
        expect(Math.max(mark.y1, mark.y2)).toBeLessThanOrEqual(page.height);
      }
    });
  }

  it("10 × 15 jsou dvě vedle sebe na A4 naležato", () => {
    expect(signPage("frame")).toEqual({ width: 297, height: 210 });
    expect(signRects("frame")).toHaveLength(2);
    expect(signRects("a5")).toHaveLength(1);
  });
});

describe("signCopy", () => {
  it("věta bez aplikace jen u vlastní galerie", () => {
    expect(signCopy("cs", "upload", true).instruction).toContain("Bez aplikace");
    expect(signCopy("cs", "upload", false).instruction).not.toContain("Bez aplikace");
    expect(signCopy("en", "view", true).heading).toBe("Wedding photos");
  });

  it("česká typografie: nezlomitelná mezera za jednopísmennou předložkou", () => {
    expect(signCopy("cs", "view", false).instruction).toContain("a prohlédněte");
  });
});
