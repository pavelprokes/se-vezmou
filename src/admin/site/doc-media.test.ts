import { describe, expect, it } from "vitest";
import type { MediaItem } from "@/lib/media/types";
import { publicContentSchema, sensitiveContentSchema } from "@/site/types";
import {
  docToPublic,
  editorDocSchema,
  normalizeBlocks,
  publicToDoc,
  publishable,
  reconcileGalleryMedia,
  translationGaps,
  validateDoc,
  type EditorBlock,
  type EditorDoc,
} from "./doc";

/**
 * Fotografie v pracovní kopii a ve snímku (M7c): pořadí v galerii, zveřejnitelnost (popisek, nebo dekorativní),
 * fotografie chráněné PINem, obrázek karty externí galerie a vrácení verze.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CARD_URL = "https://fotky.example/galerie";

function photo(n: number, patch: Partial<MediaItem> = {}): MediaItem {
  return {
    id: ID(n),
    kind: "photo",
    status: "ready",
    failureCode: null,
    width: 1920,
    height: 1280,
    bytes: 1000,
    alt: { cs: `Fotografie ${n}`, en: `Photo ${n}` },
    decorative: false,
    widths: [640, 1280, 1920],
    ...patch,
  };
}

function cardImage(n: number): MediaItem {
  return photo(n, {
    kind: "card",
    alt: null,
    decorative: true,
    widths: [640, 1280],
    width: 1280,
    height: 640,
  });
}

function docWithGallery(data: Record<string, unknown> = {}, enabled = true): EditorDoc {
  const doc = editorDocSchema.parse({
    wedding: {
      partnerA: "Klára",
      partnerB: "Matěj",
      startsOn: "2027-06-19",
      endsOn: null,
      timezone: "Europe/Prague",
      locales: ["cs", "en"],
      defaultLocale: "cs",
      template: "chateau",
      palette: "slonovina",
    },
    venues: [
      {
        id: ID(901),
        name: { cs: "Zámek" },
        address: "Zámecká 1",
        isPrivate: false,
        directions: null,
        mapUrl: null,
      },
    ],
    events: [],
    blocks: [],
  });
  return {
    ...doc,
    blocks: normalizeBlocks(doc.blocks).map((b) =>
      b.type === "gallery"
        ? ({
            ...b,
            enabled,
            data: { mediaIds: [], photosProtected: false, link: null, ...data },
          } as EditorBlock)
        : b,
    ),
  };
}

const build = (doc: EditorDoc, media?: readonly MediaItem[]) => {
  const built = docToPublic(doc, { slug: "klara-a-matej", phase: "save_the_date", media });
  if (!built) throw new Error("snímek se nesestavil");
  return built;
};

const galleryOf = (content: ReturnType<typeof build>["content"]) => {
  const block = content.blocks.find((b) => b.type === "gallery");
  if (block?.type !== "gallery") throw new Error("galerie");
  return block;
};

describe("docToPublic: fotografie ve snímku", () => {
  it("do snímku jdou hotové zveřejnitelné fotografie v pořadí z dokumentu, s adresou největší varianty", () => {
    const doc = docWithGallery({ mediaIds: [ID(2), ID(1)] });
    const { content, sensitive } = build(doc, [photo(1), photo(2)]);
    expect(galleryOf(content).data.mediaIds).toEqual([ID(2), ID(1)]);
    expect(content.media.map((m) => m.id)).toEqual([ID(2), ID(1)]);
    expect(content.media[0]).toEqual({
      id: ID(2),
      src: `/media/${ID(2)}/1920`,
      width: 1920,
      height: 1280,
      alt: { cs: "Fotografie 2", en: "Photo 2" },
      decorative: false,
      widths: [640, 1280, 1920],
    });
    expect(sensitive.photos).toEqual([]);
    expect(publicContentSchema.safeParse(content).success).toBe(true);
  });

  it("fotografie bez popisku a bez příznaku dekorativní se nezveřejní, dekorativní ano s prázdným alt", () => {
    const doc = docWithGallery({ mediaIds: [ID(1), ID(2), ID(3)] });
    const media = [
      photo(1, { alt: null }),
      photo(2, { alt: null, decorative: true }),
      photo(3, { alt: { cs: "  ", en: "" } }),
    ];
    const { content } = build(doc, media);
    expect(galleryOf(content).data.mediaIds).toEqual([ID(2)]);
    expect(content.media.map((m) => [m.id, m.decorative, m.alt])).toEqual([[ID(2), true, null]]);
  });

  it("stačí popisek v jednom jazyce (chybějící překlad zveřejnění nebrání)", () => {
    const doc = docWithGallery({ mediaIds: [ID(1)] });
    const { content } = build(doc, [photo(1, { alt: { en: "Only English" } })]);
    expect(galleryOf(content).data.mediaIds).toEqual([ID(1)]);
    expect(content.media[0].alt).toEqual({ en: "Only English" });
  });

  it("nehotové, chybné a neznámé fotografie se vynechají, duplicity zmizí", () => {
    const doc = docWithGallery({ mediaIds: [ID(1), ID(1), ID(2), ID(3), ID(404)] });
    const media = [
      photo(1),
      photo(2, { status: "processing", widths: [], width: null, height: null }),
      photo(3, { status: "failed", failureCode: "corrupt", widths: [], width: null, height: null }),
    ];
    const { content } = build(doc, media);
    expect(galleryOf(content).data.mediaIds).toEqual([ID(1)]);
    expect(content.media.map((m) => m.id)).toEqual([ID(1)]);
  });

  it("obrázek karty není fotografie galerie, i když by jeho identifikátor byl v seznamu", () => {
    const doc = docWithGallery({ mediaIds: [ID(7)] });
    const { content } = build(doc, [cardImage(7)]);
    expect(galleryOf(content).data.mediaIds).toEqual([]);
    expect(content.media).toEqual([]);
  });

  it("vypnutý blok galerie nezveřejní žádné fotografie", () => {
    const doc = docWithGallery({ mediaIds: [ID(1)] }, false);
    const { content } = build(doc, [photo(1)]);
    expect(content.media).toEqual([]);
    expect(galleryOf(content).data.mediaIds).toEqual([]);
  });

  it("bez přehledu médií (starší volání) zůstávají odkazy beze změny a media je prázdné", () => {
    const doc = docWithGallery({ mediaIds: [ID(1)] });
    const { content } = build(doc);
    expect(galleryOf(content).data.mediaIds).toEqual([ID(1)]);
    expect(content.media).toEqual([]);
  });
});

describe("fotografie chráněné PINem hostů", () => {
  const doc = () => docWithGallery({ mediaIds: [ID(1), ID(2)], photosProtected: true });

  it("nejsou ve veřejném snímku (ani jako identifikátory a popisky), jen v citlivé části v pořadí", () => {
    const { content, sensitive } = build(doc(), [photo(1), photo(2)]);
    const json = JSON.stringify(content);
    expect(galleryOf(content).data).toMatchObject({ mediaIds: [], photosProtected: true });
    expect(content.media).toEqual([]);
    for (const needle of [ID(1), ID(2), "Fotografie 1", "Photo 2", "/media/"]) {
      expect(json).not.toContain(needle);
    }
    expect(sensitive.photos.map((m) => m.id)).toEqual([ID(1), ID(2)]);
    expect(sensitiveContentSchema.safeParse(sensitive).success).toBe(true);
  });

  it("vyžadují PIN hostů: bez něj je to upozornění jako u ostatních chráněných částí", () => {
    const issues = validateDoc(doc(), { guestPinReady: false, media: [photo(1)] });
    expect(issues).toContainEqual({ code: "guestPinMissing", severity: "warning", area: "gifts" });
    expect(
      validateDoc(doc(), { guestPinReady: true, media: [photo(1)] }).some(
        (i) => i.code === "guestPinMissing",
      ),
    ).toBe(false);
  });

  it("vrácení verze obnoví pořadí chráněných fotografií i příznak", () => {
    const { content, sensitive } = build(doc(), [photo(1), photo(2)]);
    const restored = publicToDoc(content, sensitive);
    const gallery = restored.blocks.find((b) => b.type === "gallery");
    expect(gallery?.type === "gallery" && gallery.data.mediaIds).toEqual([ID(1), ID(2)]);
    expect(gallery?.type === "gallery" && gallery.data.photosProtected).toBe(true);
  });
});

describe("obrázek karty externí galerie", () => {
  const link = (protectedLink = false, imageMediaId: string | null = ID(50)) => ({
    url: CARD_URL,
    label: null,
    protected: protectedLink,
    card: {
      title: "Galerie",
      description: null,
      imageUrl: "https://cdn.example/cover.jpg",
      fetchedAt: null,
      imageMediaId,
      status: "ok" as const,
    },
  });

  it("veřejná karta: kopie obrázku je ve veřejném snímku a vykreslí se z vlastní adresy", () => {
    const { content, sensitive } = build(docWithGallery({ link: link() }), [cardImage(50)]);
    const gallery = galleryOf(content);
    expect(gallery.data.link?.card?.imageMediaId).toBe(ID(50));
    expect(content.media.map((m) => [m.id, m.decorative, m.alt])).toEqual([[ID(50), true, null]]);
    expect(sensitive.photos).toEqual([]);
  });

  it("chráněná karta: adresa, karta i kopie obrázku jsou jen v citlivé části", () => {
    const { content, sensitive } = build(docWithGallery({ link: link(true) }), [cardImage(50)]);
    const json = JSON.stringify(content);
    expect(json).not.toContain(CARD_URL);
    expect(json).not.toContain(ID(50));
    expect(content.media).toEqual([]);
    expect(sensitive.gallery?.card?.imageMediaId).toBe(ID(50));
    expect(sensitive.photos.map((m) => m.id)).toEqual([ID(50)]);
  });

  it("chybějící nebo cizí médium karty se z karty odstraní, odkaz zůstane", () => {
    const { content } = build(docWithGallery({ link: link(false, ID(51)) }), [cardImage(50)]);
    expect(galleryOf(content).data.link?.card?.imageMediaId).toBeNull();
    expect(galleryOf(content).data.link?.url).toBe(CARD_URL);
    // fotografie nelze podstrčit jako obrázek karty
    const withPhoto = build(docWithGallery({ link: link(false, ID(1)) }), [photo(1)]);
    expect(galleryOf(withPhoto.content).data.link?.card?.imageMediaId).toBeNull();
    expect(withPhoto.content.media).toEqual([]);
  });

  it("selhavší karta obrázek nenese", () => {
    const failed = link();
    failed.card.status = "failed" as never;
    const { content } = build(docWithGallery({ link: failed }), [cardImage(50)]);
    expect(content.media).toEqual([]);
  });
});

describe("validateDoc a translationGaps: upozornění na popisky", () => {
  it("fotografie bez popisku je upozornění (ne chyba), zveřejnění nebrání", () => {
    const doc = docWithGallery({ mediaIds: [ID(1), ID(2)] });
    const issues = validateDoc(doc, {
      guestPinReady: false,
      media: [photo(1, { alt: null }), photo(2)],
    });
    expect(issues.filter((i) => i.code === "photoNoCaption")).toEqual([
      { code: "photoNoCaption", severity: "warning", area: "gallery", itemId: ID(1) },
    ]);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("dekorativní fotografie bez popisku upozornění nemá", () => {
    const doc = docWithGallery({ mediaIds: [ID(1)] });
    const issues = validateDoc(doc, {
      guestPinReady: false,
      media: [photo(1, { alt: null, decorative: true })],
    });
    expect(issues.some((i) => i.code === "photoNoCaption")).toBe(false);
  });

  it("galerie bez zveřejnitelné fotografie a bez odkazu je prázdná sekce (upozornění)", () => {
    const doc = docWithGallery({ mediaIds: [ID(1)] });
    expect(
      validateDoc(doc, { guestPinReady: false, media: [photo(1, { alt: null })] }).some(
        (i) => i.code === "emptyBlock" && i.area === "gallery",
      ),
    ).toBe(true);
    expect(
      validateDoc(doc, { guestPinReady: false, media: [photo(1)] }).some(
        (i) => i.code === "emptyBlock" && i.area === "gallery",
      ),
    ).toBe(false);
  });

  it("chybějící překlad popisku se hlásí jako u ostatních textů, dekorativní fotografie ne", () => {
    const doc = docWithGallery({ mediaIds: [ID(1), ID(2), ID(3)] });
    const gaps = translationGaps(doc, [
      photo(1, { alt: { cs: "Jen česky" } }),
      photo(2, { alt: { cs: "Také jen česky" } }),
      photo(3, { alt: { cs: "Dekorace" }, decorative: true }),
    ]);
    expect(gaps).toContainEqual({ area: "gallery", locale: "en", count: 2 });
    // bez přehledu médií se fotografie nekontrolují
    expect(translationGaps(doc).filter((gap) => gap.area === "gallery")).toEqual([]);
  });

  it("publishable: popisek aspoň v jednom jazyce, nebo dekorativní", () => {
    expect(publishable(photo(1, { alt: null }))).toBe(false);
    expect(publishable(photo(1, { alt: { cs: "  " } }))).toBe(false);
    expect(publishable(photo(1, { alt: { en: "x" } }))).toBe(true);
    expect(publishable(photo(1, { alt: null, decorative: true }))).toBe(true);
  });
});

describe("reconcileGalleryMedia: pořadí z dokumentu a tabulka médií", () => {
  it("smazané fotografie zmizí, nové přibudou na konec, pořadí zůstane", () => {
    const doc = docWithGallery({ mediaIds: [ID(3), ID(1), ID(99)] });
    const next = reconcileGalleryMedia(doc, [photo(1), photo(2), photo(3)]);
    const gallery = next.blocks.find((b) => b.type === "gallery");
    expect(gallery?.type === "gallery" && gallery.data.mediaIds).toEqual([ID(3), ID(1), ID(2)]);
  });

  it("bez změny vrací stejný objekt, nehotové a chybné fotografie a karty se do galerie nepřidávají", () => {
    const doc = docWithGallery({ mediaIds: [ID(1)] });
    expect(reconcileGalleryMedia(doc, [photo(1)])).toBe(doc);
    const next = reconcileGalleryMedia(doc, [
      photo(1),
      photo(2, { status: "failed", failureCode: "corrupt", widths: [], width: null, height: null }),
      photo(3, { status: "processing", widths: [], width: null, height: null }),
      cardImage(4),
    ]);
    expect(next).toBe(doc);
  });

  it("duplicity v pořadí zmizí", () => {
    const doc = docWithGallery({ mediaIds: [ID(1), ID(1)] });
    const next = reconcileGalleryMedia(doc, [photo(1)]);
    const gallery = next.blocks.find((b) => b.type === "gallery");
    expect(gallery?.type === "gallery" && gallery.data.mediaIds).toEqual([ID(1)]);
  });
});
