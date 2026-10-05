import { writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderNameCardsPdf } from "./pdf";
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

async function render(format: "flat" | "tent", count: number, template = "chateau" as const) {
  const bytes = await renderNameCardsPdf({
    locale: "cs",
    names: Array.from({ length: count }, (_, i) => names[i % names.length]),
    format,
    style: cardStyle(template, "champagne"),
    detail: "Klára & Matěj · 12. 6. 2027",
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
