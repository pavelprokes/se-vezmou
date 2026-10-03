import { describe, expect, it } from "vitest";
import { previewToPublicContent } from "./preview";

const wedding = {
  default_locale: "cs",
  locales: ["cs"],
  template: "eukalyptus",
  palette: "stribrna",
  partner_a_name: "Klára",
  partner_b_name: "Matěj",
  starts_on: "2027-06-19",
  ends_on: null,
  timezone: "Europe/Prague",
};

const raw = (over: Record<string, unknown> = {}) => ({
  mode: "preview",
  wedding,
  pages: [
    {
      path: "",
      blocks: [
        { id: "b1", type: "hero", anchor: "uvod", sensitive: false, data: { countdown: true } },
        { id: "b2", type: "program", anchor: "program", sensitive: false, data: {} },
      ],
    },
  ],
  events: [],
  venues: [
    { id: "v1", name: { cs: "Zámek" }, directions: null, address: "Zámecká 1, Praha" },
    { id: "v2", name: { cs: "Soukromé místo" }, directions: null, address: null },
  ],
  ...over,
});

describe("previewToPublicContent", () => {
  it("odpověď neočekávaného tvaru dá null", () => {
    expect(previewToPublicContent({ mode: "public" }, "klara-a-matej")).toBeNull();
    expect(previewToPublicContent(null, "klara-a-matej")).toBeNull();
  });

  it("koncept bez data svatby ani bez stránek se nevykreslí", () => {
    expect(
      previewToPublicContent(raw({ wedding: { ...wedding, starts_on: null } }), "a-b"),
    ).toBeNull();
    expect(previewToPublicContent(raw({ pages: [] }), "a-b")).toBeNull();
  });

  it("přenese jména, slug a bloky v pořadí; soukromé místo bez adresy vynechá", () => {
    const content = previewToPublicContent(raw(), "klara-a-matej", new Date("2027-01-01"));
    if (!content) throw new Error("očekáván obsah");
    expect(content.slug).toBe("klara-a-matej");
    expect(content.partners).toEqual({ a: "Klára", b: "Matěj" });
    expect(content.phase).toBe("rsvp_open");
    expect(content.venues.map((venue) => venue.id)).toEqual(["v1"]);
    expect(content.blocks.map((block) => [block.id, block.position, block.enabled])).toEqual([
      ["b1", 1, true],
      ["b2", 2, true],
    ]);
    expect(content.media).toEqual([]);
  });

  it("odkaz na mapu veřejného místa se přenese, starší odpověď bez něj dá null", () => {
    const withMap = raw({
      venues: [
        {
          id: "v1",
          name: { cs: "Zámek" },
          directions: null,
          address: "Zámecká 1, Praha",
          map_url: "https://mapy.example/zamek",
        },
      ],
    });
    expect(previewToPublicContent(withMap, "a-b", new Date("2027-01-01"))?.venues[0].mapUrl).toBe(
      "https://mapy.example/zamek",
    );
    expect(
      previewToPublicContent(raw(), "a-b", new Date("2027-01-01"))?.venues[0].mapUrl,
    ).toBeNull();
  });

  it("chráněný odkaz na galerii náhled neshodí: adresa ani karta v něm nejsou", () => {
    const gallery = {
      id: "b3",
      type: "gallery",
      anchor: "galerie",
      sensitive: false,
      data: {
        mediaIds: [],
        photosProtected: false,
        link: { url: "https://fotky.example/tajne", label: null, protected: true, card: null },
      },
    };
    const content = previewToPublicContent(
      raw({ pages: [{ path: "", blocks: [raw().pages[0].blocks[0], gallery] }] }),
      "a-b",
      new Date("2027-01-01"),
    );
    if (!content) throw new Error("očekáván obsah");
    const block = content.blocks.find((b) => b.type === "gallery");
    expect(block?.type === "gallery" && block.data.link).toMatchObject({
      protected: true,
      url: null,
    });
    expect(JSON.stringify(content)).not.toContain("tajne");
  });

  it("blok, který neprojde schématem, se vynechá (zbytek náhledu zůstane)", () => {
    const broken = {
      id: "b9",
      type: "contact",
      anchor: "kontakt",
      sensitive: false,
      data: { people: [{ id: "p", name: "X", phone: "neplatné" }] },
    };
    const content = previewToPublicContent(
      raw({ pages: [{ path: "", blocks: [...raw().pages[0].blocks, broken] }] }),
      "a-b",
      new Date("2027-01-01"),
    );
    expect(content?.blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("fáze náhledu respektuje termín potvrzení účasti a časové pásmo svatby", () => {
    const closed = previewToPublicContent(
      raw({ wedding: { ...wedding, rsvp_closes_at: "2027-05-01T21:59:00Z" } }),
      "a-b",
      new Date("2027-05-02T08:00:00Z"),
    );
    expect(closed?.phase).toBe("rsvp_closed");
    // 18. 6. 23:30 UTC je v Praze už den svatby (19. 6.)
    const day = previewToPublicContent(raw(), "a-b", new Date("2027-06-18T23:30:00Z"));
    expect(day?.phase).toBe("wedding_day");
  });
});
