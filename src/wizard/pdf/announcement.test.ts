import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { Block } from "@/site/types";
import { pickGalleryUrl, renderAnnouncementPdf, type AnnouncementInput } from "./announcement";

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

describe("QR kód fotogalerie", () => {
  const galleryUrl = "https://fotky.example/klara-a-matej";

  it("s adresou galerie je pořád jedna stránka a PDF je větší o druhý kód", async () => {
    const plain = await renderAnnouncementPdf(input);
    for (const locale of ["cs", "en"] as const) {
      const withGallery = await renderAnnouncementPdf({ ...input, locale, galleryUrl });
      expect((await PDFDocument.load(withGallery)).getPageCount()).toBe(1);
      expect(withGallery.byteLength).toBeLessThan(200_000);
    }
    const cs = await renderAnnouncementPdf({ ...input, galleryUrl });
    expect(cs.byteLength).toBeGreaterThan(plain.byteLength);
  });

  it("bez PINu se vykreslí také a bez galerie je výstup jako dřív", async () => {
    const bytes = await renderAnnouncementPdf({ ...input, pin: null, galleryUrl });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const nothing = await renderAnnouncementPdf({ ...input, galleryUrl: null });
    expect((await PDFDocument.load(nothing)).getPageCount()).toBe(1);
  });

  it("pickGalleryUrl bere jen zapnutý blok s veřejným odkazem", () => {
    const block = (enabled: boolean, link: unknown): Block =>
      ({
        id: "00000000-0000-4000-8000-000000000001",
        type: "gallery",
        anchor: "fotky",
        enabled,
        position: 0,
        sensitive: false,
        data: { mediaIds: [], photosProtected: false, link },
      }) as Block;
    const open = { url: galleryUrl, label: null, protected: false, card: null };
    expect(pickGalleryUrl([block(true, open)])).toBe(galleryUrl);
    expect(pickGalleryUrl([block(false, open)])).toBeNull();
    expect(pickGalleryUrl([block(true, { ...open, url: null, protected: true })])).toBeNull();
    expect(pickGalleryUrl([block(true, null)])).toBeNull();
    expect(pickGalleryUrl([])).toBeNull();
  });

  it("pickGalleryUrl označí vlastní galerii autora značkami UTM", () => {
    const own = "https://photos.svatebni-fotograf-cechy.cz/s/abc/klara-a-matej";
    const block = {
      id: "00000000-0000-4000-8000-000000000001",
      type: "gallery",
      anchor: "fotky",
      enabled: true,
      position: 0,
      sensitive: false,
      data: {
        mediaIds: [],
        photosProtected: false,
        link: { url: own, label: null, protected: false, card: null },
      },
    } as Block;
    const picked = new URL(pickGalleryUrl([block]) ?? "");
    expect(picked.searchParams.get("utm_medium")).toBe("qr-oznameni");
    expect(picked.searchParams.get("utm_source")).toBe("se-vezmou");
  });
});
