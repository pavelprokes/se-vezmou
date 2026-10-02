import { describe, expect, it } from "vitest";
import { publicContentSchema, sensitiveContentSchema } from "@/site/types";
import {
  docToPublic,
  docToWork,
  editorDocSchema,
  emptyBlock,
  moveBlock,
  moveBlockTo,
  normalizeBlocks,
  parseLoaded,
  publicToDoc,
  resolveAccount,
  setBlockEnabled,
  translationGaps,
  validateDoc,
  type EditorBlock,
  type EditorDoc,
} from "./doc";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function baseDoc(): EditorDoc {
  return editorDocSchema.parse({
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
        id: ID(1),
        name: { cs: "Zámek" },
        address: "Zámecká 1",
        isPrivate: false,
        directions: null,
        mapUrl: "https://mapy.example/zamek",
      },
      {
        id: ID(2),
        name: { cs: "Zahrada" },
        address: "Tajná 7",
        isPrivate: true,
        directions: { cs: "Za vrátky" },
        mapUrl: null,
      },
    ],
    events: [
      {
        id: ID(3),
        kind: "ceremony",
        title: { cs: "Obřad", en: "Ceremony" },
        description: null,
        startsAt: "2027-06-19T14:00:00+02:00",
        endsAt: null,
        venueId: ID(1),
        rsvpEnabled: true,
      },
    ],
    blocks: [],
  });
}

function withBlocks(doc: EditorDoc, patch: (blocks: EditorBlock[]) => EditorBlock[]): EditorDoc {
  return { ...doc, blocks: normalizeBlocks(patch(normalizeBlocks(doc.blocks))) };
}

function enable(blocks: EditorBlock[], type: EditorBlock["type"], data?: Record<string, unknown>) {
  return blocks.map((b) =>
    b.type === type ? ({ ...b, enabled: true, data: { ...b.data, ...data } } as EditorBlock) : b,
  );
}

describe("bloky: doplnění, pořadí a zapínání", () => {
  it("doplní všech 11 druhů, úvod je první a zapnutý, kotvy jsou pevné", () => {
    const blocks = normalizeBlocks([]);
    expect(blocks).toHaveLength(11);
    expect(blocks[0]).toMatchObject({ type: "hero", enabled: true, position: 1 });
    expect(blocks.map((b) => b.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(blocks.map((b) => b.anchor)).size).toBe(11);
    expect(blocks.find((b) => b.type === "gifts")?.sensitive).toBe(true);
  });

  it("každý druh je jednou, úvod nejde vypnout", () => {
    const duplicate = [
      emptyBlock("faq", 1),
      emptyBlock("faq", 2),
      { ...emptyBlock("hero", 3), enabled: false },
    ];
    const blocks = normalizeBlocks(duplicate);
    expect(blocks.filter((b) => b.type === "faq")).toHaveLength(1);
    expect(blocks.find((b) => b.type === "hero")?.enabled).toBe(true);
    expect(setBlockEnabled(blocks, blocks[0].id, false)[0].enabled).toBe(true);
  });

  it("tlačítka nahoru a dolů přehodí sousední bloky, úvod zůstává první", () => {
    const blocks = normalizeBlocks([]);
    const [hero, program, venue] = blocks;
    const down = moveBlock(blocks, program.id, 1);
    expect(down.map((b) => b.type).slice(0, 3)).toEqual(["hero", "venue", "program"]);
    expect(down.map((b) => b.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const up = moveBlock(down, program.id, -1);
    expect(up.map((b) => b.id)).toEqual(blocks.map((b) => b.id));
    expect(moveBlock(blocks, program.id, -1).map((b) => b.type)[0]).toBe("hero");
    expect(moveBlock(blocks, hero.id, 1).map((b) => b.id)).toEqual(blocks.map((b) => b.id));
    expect(moveBlock(blocks, blocks[10].id, 1).map((b) => b.id)).toEqual(blocks.map((b) => b.id));
    void venue;
  });

  it("přetažení přesune blok na místo cíle", () => {
    const blocks = normalizeBlocks([]);
    const moved = moveBlockTo(blocks, blocks[1].id, blocks[4].id);
    expect(moved.map((b) => b.type)).toEqual([
      "hero",
      "venue",
      "lodging",
      "dresscode",
      "program",
      "faq",
      "contact",
      "story",
      "gifts",
      "gallery",
      "rsvp",
    ]);
    expect(moveBlockTo(blocks, blocks[1].id, blocks[0].id).map((b) => b.id)).toEqual(
      blocks.map((b) => b.id),
    );
  });
});

describe("docToPublic: veřejný snímek a citlivá část", () => {
  it("soukromé místo, číslo účtu a chráněný odkaz jdou jen do citlivé části", () => {
    const doc = withBlocks(baseDoc(), (blocks) =>
      enable(
        enable(enable(blocks, "venue", { venueIds: [ID(1), ID(2)] }), "gifts", {
          account: "19-2000145399/0800",
          holder: "Klára Nováková",
          paymentMessage: "Dar",
        }),
        "gallery",
        {
          link: {
            url: "https://fotky.example/svatba/tajne-abc123",
            label: { cs: "Fotky od Anny" },
            protected: true,
            card: {
              title: "Svatba",
              description: "Popis",
              imageUrl: "https://fotky.example/og.jpg",
              fetchedAt: "2026-10-02T10:00:00+00:00",
              status: "ok",
            },
          },
        },
      ),
    );
    const built = docToPublic(doc, { slug: "klara-a-matej" });
    expect(built).not.toBeNull();
    const { content, sensitive } = built!;
    expect(publicContentSchema.safeParse(content).success).toBe(true);
    expect(sensitiveContentSchema.safeParse(sensitive).success).toBe(true);

    const text = JSON.stringify(content);
    expect(text).not.toContain("Tajná 7");
    expect(text).not.toContain("Za vrátky");
    expect(text).not.toContain("19-2000145399");
    expect(text).not.toContain("tajne-abc123");
    expect(text).not.toContain("Klára Nováková");
    expect(text).not.toContain("og.jpg");
    expect(sensitive.venues[ID(2)]).toMatchObject({ address: "Tajná 7" });
    expect(sensitive.gifts).toMatchObject({
      account: "19-2000145399/0800",
      iban: "CZ6508000000192000145399",
      holder: "Klára Nováková",
    });
    expect(sensitive.gallery?.url).toBe("https://fotky.example/svatba/tajne-abc123");
    expect(sensitive.gallery?.card?.title).toBe("Svatba");

    const gallery = content.blocks.find((b) => b.type === "gallery");
    expect(gallery?.type === "gallery" && gallery.data.link).toMatchObject({
      url: null,
      protected: true,
      card: null,
    });
    const venue = content.venues.find((v) => v.id === ID(2));
    expect(venue).toMatchObject({ isPrivate: true, address: null, directions: null, mapUrl: null });
  });

  it("veřejný odkaz na galerii je ve snímku i s kartou, bez citlivé části", () => {
    const doc = withBlocks(baseDoc(), (blocks) =>
      enable(blocks, "gallery", {
        link: {
          url: "fotky.example/svatba",
          label: null,
          protected: false,
          card: {
            title: "Fotky",
            description: null,
            imageUrl: null,
            fetchedAt: null,
            status: "ok",
          },
        },
      }),
    );
    const { content, sensitive } = docToPublic(doc, { slug: "klara-a-matej" })!;
    const gallery = content.blocks.find((b) => b.type === "gallery");
    expect(gallery?.type === "gallery" && gallery.data.link).toMatchObject({
      url: "https://fotky.example/svatba",
      protected: false,
      card: { title: "Fotky" },
    });
    expect(sensitive.gallery).toBeNull();
  });

  it("odkaz na galerii bez https se do snímku nedostane (žádné javascript: ani http:)", () => {
    for (const url of ["javascript:alert(1)", "http://fotky.example/a", "data:text/html,x"]) {
      const doc = withBlocks(baseDoc(), (blocks) =>
        enable(blocks, "gallery", { link: { url, label: null, protected: false, card: null } }),
      );
      const built = docToPublic(doc, { slug: "klara-a-matej" });
      const gallery = built?.content.blocks.find((b) => b.type === "gallery");
      expect(gallery?.type === "gallery" && gallery.data.link).toBeNull();
      expect(JSON.stringify(built)).not.toContain(url);
    }
  });

  it("vypnutý blok darů nepřidá číslo účtu do citlivé části", () => {
    const doc = withBlocks(baseDoc(), (blocks) =>
      blocks.map((b) =>
        b.type === "gifts"
          ? ({
              ...b,
              enabled: false,
              data: { ...b.data, account: "19-2000145399/0800" },
            } as EditorBlock)
          : b,
      ),
    );
    expect(docToPublic(doc, { slug: "klara-a-matej" })?.sensitive.gifts).toBeNull();
  });

  it("neplatný dokument (bez data) snímek nevytvoří", () => {
    const doc = { ...baseDoc(), wedding: { ...baseDoc().wedding, startsOn: "" } };
    expect(docToPublic(doc, { slug: "klara-a-matej" })).toBeNull();
  });

  it("události se řadí podle okamžiku, ne podle řetězce (různé posuny ISO času)", () => {
    const doc = baseDoc();
    // 14:00+02:00 = 12:00Z (obřad), databáze vrací UTC, formulář pásmo svatby
    doc.events[0].startsAt = "2027-06-19T12:00:00+00:00";
    doc.events.push(
      { ...doc.events[0], id: ID(5), title: { cs: "Ráno" }, startsAt: "2027-06-19T09:30:00+02:00" },
      {
        ...doc.events[0],
        id: ID(6),
        title: { cs: "Večer" },
        startsAt: "2027-06-19T20:00:00+02:00",
      },
    );
    const { content } = docToPublic(doc, { slug: "klara-a-matej" })!;
    expect(content.events.map((e) => e.id)).toEqual([ID(5), ID(3), ID(6)]);
  });

  it("události jsou seřazené podle času a nesou pozvání na RSVP", () => {
    const doc = baseDoc();
    doc.events.push({
      ...doc.events[0],
      id: ID(4),
      kind: "other",
      title: { cs: "Snídaně" },
      startsAt: "2027-06-19T09:00:00+02:00",
      rsvpEnabled: false,
    });
    const { content } = docToPublic(doc, { slug: "klara-a-matej" })!;
    expect(content.events.map((e) => e.id)).toEqual([ID(4), ID(3)]);
    expect(content.events.map((e) => e.rsvpEnabled)).toEqual([false, true]);
  });
});

describe("publicToDoc: vrácení verze", () => {
  it("snímek se sestavením a vrácením nemění obsah", () => {
    const doc = withBlocks(baseDoc(), (blocks) =>
      enable(
        enable(enable(blocks, "venue", { venueIds: [ID(1), ID(2)] }), "gifts", {
          account: "19-2000145399/0800",
          holder: "Klára",
          paymentMessage: "Dar",
        }),
        "gallery",
        {
          link: {
            url: "https://fotky.example/a",
            label: { cs: "Fotky" },
            protected: true,
            card: null,
          },
        },
      ),
    );
    const built = docToPublic(doc, { slug: "klara-a-matej" })!;
    const restored = publicToDoc(built.content, built.sensitive);
    expect(restored.venues.find((v) => v.id === ID(2))).toMatchObject({
      address: "Tajná 7",
      isPrivate: true,
      directions: { cs: "Za vrátky" },
    });
    const gifts = restored.blocks.find((b) => b.type === "gifts");
    expect(gifts?.type === "gifts" && gifts.data).toMatchObject({
      account: "19-2000145399/0800",
      holder: "Klára",
      paymentMessage: "Dar",
    });
    const gallery = restored.blocks.find((b) => b.type === "gallery");
    expect(gallery?.type === "gallery" && gallery.data.link).toMatchObject({
      url: "https://fotky.example/a",
      protected: true,
    });
    const again = docToPublic(restored, { slug: "klara-a-matej" })!;
    expect(again.content).toEqual(built.content);
    expect(again.sensitive).toEqual(built.sensitive);
  });

  it("starý snímek bez rsvpEnabled: obřad a hostina ano, ostatní ne", () => {
    const doc = baseDoc();
    doc.events.push({ ...doc.events[0], id: ID(4), kind: "other", title: { cs: "Snídaně" } });
    const built = docToPublic(doc, { slug: "klara-a-matej" })!;
    const old = publicContentSchema.parse({
      ...built.content,
      events: built.content.events.map((event) => {
        const { rsvpEnabled, ...rest } = event;
        void rsvpEnabled;
        return rest;
      }),
    });
    const restored = publicToDoc(old, sensitiveContentSchema.parse({}));
    expect(restored.events.map((e) => [e.kind, e.rsvpEnabled])).toEqual(
      expect.arrayContaining([
        ["ceremony", true],
        ["other", false],
      ]),
    );
  });
});

describe("validateDoc", () => {
  const ready = { guestPinReady: true };

  it("úplný dokument nemá chyby", () => {
    expect(validateDoc(baseDoc(), ready).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("hlásí chybějící jména, datum, adresu místa, název události a neplatnou paletu", () => {
    const doc = baseDoc();
    doc.wedding.partnerA = " ";
    doc.wedding.startsOn = "";
    doc.wedding.palette = "neexistuje";
    doc.venues[0].address = "";
    doc.events[0].title = {};
    doc.events[0].endsAt = "2027-06-19T13:00:00+02:00";
    const codes = validateDoc(doc, ready)
      .filter((i) => i.severity === "error")
      .map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "names",
        "date",
        "palette",
        "venueAddress",
        "eventTitle",
        "eventTime",
      ]),
    );
  });

  it("zapnuté dary bez platného účtu jsou chyba, platný účet ne", () => {
    const bad = withBlocks(baseDoc(), (b) => enable(b, "gifts", { account: "124/0100" }));
    expect(validateDoc(bad, ready).some((i) => i.code === "giftsAccount")).toBe(true);
    const good = withBlocks(baseDoc(), (b) =>
      enable(b, "gifts", { account: "19-2000145399/0800" }),
    );
    expect(validateDoc(good, ready).some((i) => i.code === "giftsAccount")).toBe(false);
  });

  it("odkaz na galerii musí být https", () => {
    const bad = withBlocks(baseDoc(), (b) =>
      enable(b, "gallery", {
        link: { url: "http://x.example", label: null, protected: false, card: null },
      }),
    );
    expect(validateDoc(bad, ready).some((i) => i.code === "galleryUrl")).toBe(true);
  });

  it("údaje za PINem bez zapnutého PINu hostů jsou upozornění", () => {
    const doc = withBlocks(baseDoc(), (b) => enable(b, "gifts", { account: "19-2000145399/0800" }));
    expect(
      validateDoc(doc, { guestPinReady: false }).find((i) => i.code === "guestPinMissing"),
    ).toMatchObject({
      severity: "warning",
    });
    expect(validateDoc(doc, ready).some((i) => i.code === "guestPinMissing")).toBe(false);
  });

  it("prázdný zapnutý blok je jen upozornění", () => {
    const doc = withBlocks(baseDoc(), (b) => enable(b, "faq"));
    expect(validateDoc(doc, ready).find((i) => i.code === "emptyBlock")).toMatchObject({
      severity: "warning",
      area: "faq",
    });
  });
});

describe("translationGaps: chybějící překlady", () => {
  it("hlásí jen texty vyplněné v části jazyků", () => {
    const doc = baseDoc();
    doc.venues[0].name = { cs: "Zámek" };
    doc.events[0].title = { cs: "Obřad", en: "Ceremony" };
    const withText = withBlocks(doc, (b) => enable(b, "dresscode", { text: { cs: "Slavnostní" } }));
    const gaps = translationGaps(withText);
    expect(gaps).toEqual(
      expect.arrayContaining([
        { area: "venues", locale: "en", count: 3 },
        { area: "dresscode", locale: "en", count: 1 },
      ]),
    );
    expect(gaps.find((g) => g.area === "events")).toBeUndefined();
  });

  it("zcela prázdný text ani vypnutý blok se nehlásí, jednojazyčný web nic nehlásí", () => {
    const doc = withBlocks(baseDoc(), (b) =>
      b.map((x) =>
        x.type === "dresscode" ? ({ ...x, data: { text: { cs: "x" } } } as EditorBlock) : x,
      ),
    );
    expect(translationGaps(doc).some((g) => g.area === "dresscode")).toBe(false);
    const single = { ...baseDoc(), wedding: { ...baseDoc().wedding, locales: ["cs" as const] } };
    expect(translationGaps(single)).toEqual([]);
  });
});

describe("resolveAccount", () => {
  it("tuzemský účet i IBAN", () => {
    expect(resolveAccount("19-2000145399/0800")).toEqual({
      account: "19-2000145399/0800",
      iban: "CZ6508000000192000145399",
    });
    expect(resolveAccount("CZ65 0800 0000 1920 0014 5399")?.iban).toBe("CZ6508000000192000145399");
    expect(resolveAccount("DE89 3704 0044 0532 0130 00")?.iban).toBe("DE89370400440532013000");
    expect(resolveAccount("")).toBeNull();
    expect(resolveAccount("124/0100")).toBeNull();
    expect(resolveAccount("19-2000145398/0800")).toBeNull();
  });
});

describe("parseLoaded a docToWork", () => {
  const raw = {
    wedding: {
      id: ID(9),
      status: "published",
      slug: "klara-a-matej",
      default_locale: "cs",
      locales: ["cs"],
      template: "modern",
      palette: "kobalt",
      partner_a_name: "Klára",
      partner_b_name: "Matěj",
      starts_on: "2027-06-19",
      ends_on: null,
      timezone: "Europe/Prague",
      quick_notice: null,
      quick_notice_enabled: false,
      guest_pin_enabled: true,
      has_guest_pin: true,
      site_rev: 3,
      draft_saved_at: null,
      published_at: null,
      published_version_no: 2,
      published_version_at: null,
      has_unpublished_changes: false,
    },
    venues: [],
    events: [],
    blocks: [
      {
        id: ID(10),
        type: "faq",
        anchor: "x",
        enabled: true,
        position: 5,
        sensitive: false,
        data: { items: "rozbité" },
      },
      {
        id: ID(11),
        type: "neznamy",
        anchor: "y",
        enabled: true,
        position: 1,
        sensitive: false,
        data: {},
      },
    ],
    versions: [],
  };

  it("poškozená data bloku se nahradí prázdným blokem, neznámý druh se zahodí, chybějící se doplní", () => {
    const loaded = parseLoaded(raw)!;
    expect(loaded.doc.blocks).toHaveLength(11);
    const faq = loaded.doc.blocks.find((b) => b.type === "faq");
    expect(faq?.type === "faq" && faq.data.items).toEqual([]);
    expect(faq?.id).toBe(ID(10));
    expect(loaded.meta.rev).toBe(3);
  });

  it("odpověď jiného tvaru je null", () => {
    expect(parseLoaded({ nic: 1 })).toBeNull();
    expect(parseLoaded(null)).toBeNull();
  });

  it("docToWork vrací pole pro databázi a bloky s pevnými kotvami", () => {
    const work = docToWork(parseLoaded(raw)!.doc) as {
      blocks: { anchor: string; position: number }[];
      wedding: { template: string };
    };
    expect(work.wedding.template).toBe("modern");
    expect(work.blocks.map((b) => b.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(work.blocks.map((b) => b.anchor)).size).toBe(11);
  });
});
