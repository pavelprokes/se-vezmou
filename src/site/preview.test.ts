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
});
