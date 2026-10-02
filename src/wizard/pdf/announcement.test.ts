import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderAnnouncementPdf, type AnnouncementInput } from "./announcement";

const input: AnnouncementInput = {
  locale: "cs",
  partners: { a: "Klára", b: "Matěj" },
  startsOn: "2027-06-19",
  endsOn: null,
  host: "klara-a-matej.se-vezmou.cz",
  url: "https://klara-a-matej.se-vezmou.cz/",
  pin: "482915",
};

describe("renderAnnouncementPdf", () => {
  it("jednostránkové A4 s titulkem, autorem a jazykem", async () => {
    const bytes = await renderAnnouncementPdf(input);
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
    expect(pdf.getTitle()).toBe("Oznámení svatebního webu: Klára & Matěj");
    expect(pdf.getAuthor()).toBe("Se vezmou");
    expect(pdf.getProducer()).toContain("pdf-lib");
  });

  it("PDF je malé díky podmnožinám písem", async () => {
    const bytes = await renderAnnouncementPdf(input);
    // podmnožiny jsou malé: stránka s texty a QR kódem má pod 200 kB
    expect(bytes.byteLength).toBeLessThan(200_000);
  });

  it("anglická varianta má anglický titulek", async () => {
    const pdf = await PDFDocument.load(await renderAnnouncementPdf({ ...input, locale: "en" }));
    expect(pdf.getTitle()).toBe("Wedding website announcement: Klára & Matěj");
  });

  it("bez PINu a bez data se stránka vykreslí také (a je menší)", async () => {
    const withPin = await renderAnnouncementPdf(input);
    const bare = await renderAnnouncementPdf({ ...input, pin: null, startsOn: null });
    const pdf = await PDFDocument.load(bare);
    expect(pdf.getPageCount()).toBe(1);
    expect(bare.byteLength).toBeLessThan(withPin.byteLength);
  });

  it("dlouhá jména se zmenší, aby se vešla, a nevyhodí výjimku", async () => {
    const long = "Alžběta Kateřina Žofie Marie Terezie".repeat(2);
    const pdf = await PDFDocument.load(
      await renderAnnouncementPdf({
        ...input,
        partners: { a: long, b: long },
        endsOn: "2027-06-20",
      }),
    );
    expect(pdf.getPageCount()).toBe(1);
  });

  it("znaky, které písmo nemá, nerozbijí vkládání (nezlomitelná mezera, pomlčka)", async () => {
    const pdf = await PDFDocument.load(
      await renderAnnouncementPdf({
        ...input,
        partners: { a: "Anna Marie", b: "Jiří – Tomáš \u{1F600}" },
      }),
    );
    expect(pdf.getPageCount()).toBe(1);
  });
});
