import { writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { cardFaces, renderNameCardsPdf } from "./pdf";
import { cardStyle } from "./style";

const names = [
  "Klára Nová",
  "Matěj Procházka",
  "Bohumila Nováková-Procházková",
  "Žofie Řeháková",
  "Jan",
  "Ďurďa Šťastná",
  "Václav Dvořák",
];

async function render(format: "flat" | "tent", count: number) {
  const style = cardStyle("chateau", "champagne");
  const faces = await cardFaces(
    Array.from({ length: count }, (_, i) => names[i % names.length]),
    "Klára & Matěj · 12. 6. 2027",
    style,
    format,
  );
  const bytes = await renderNameCardsPdf({
    locale: "cs",
    faces,
    format,
    style,
    title: "Jmenovky: Klára a Matěj",
  });
  // ruční kontrola vzhledu: NAME_CARDS_PDF_OUT=/cesta npx vitest run src/admin/name-cards/pdf.test.ts
  if (process.env.NAME_CARDS_PDF_OUT) {
    writeFileSync(`${process.env.NAME_CARDS_PDF_OUT}/jmenovky-${format}.pdf`, bytes);
  }
  return PDFDocument.load(bytes);
}

describe("PDF jmenovek", () => {
  it("plochá: 10 na list, A4, titulek a jazyk", async () => {
    const pdf = await render("flat", 23);
    expect(pdf.getPageCount()).toBe(3);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
    expect(pdf.getTitle()).toBe("Jmenovky: Klára a Matěj");
  });

  it("stojánek: 6 na list", async () => {
    expect((await render("tent", 7)).getPageCount()).toBe(2);
  });
});

describe("texty jmenovek podle písma", () => {
  const style = cardStyle("chateau", "champagne");

  it("jméno v NFD se složí, emoji a znaky mimo písmo zmizí, prázdné jméno se vynechá", async () => {
    const faces = await cardFaces(
      ["C\u030Cene\u030Ck", "Klára 💍 Nová", "💍🎉"],
      null,
      style,
      "flat",
    );
    expect(faces.map((face) => face.name)).toEqual(["Čeněk", "Klára Nová"]);
  });

  it("dlouhý řádek pod jménem se zmenší a případně zkrátí, nepřeteče šířku karty", async () => {
    const [face] = await cardFaces(
      ["Jan"],
      `${"Bohumila Nováková-Procházková & Maximilián Dvořák-Šťastný".repeat(2)} · 12. 6. 2027`,
      style,
      "flat",
    );
    expect(face.detail?.sizePt).toBe(6);
    expect(face.detail?.text.endsWith("…")).toBe(true);
  });

  it("jediné velmi dlouhé slovo se zmenší pod 9 pt, ale ne pod 6 pt", async () => {
    const [face] = await cardFaces(
      ["Nejneobhospodařovávatelnějšímiaktivitami"],
      null,
      style,
      "flat",
    );
    expect(face.sizePt).toBeLessThan(14);
    expect(face.sizePt).toBeGreaterThanOrEqual(6);
  });
});
