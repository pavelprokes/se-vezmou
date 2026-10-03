import { describe, expect, it } from "vitest";
import { validatePalette } from "@/site/themes/validate";
import { getPalette } from "@/site/themes/palettes";
import { SITE_NAMESPACES, createSiteCtx, renderableBlocks } from "@/components/site/context";
import { getTranslator } from "@/i18n/load";
import { publicContentSchema } from "@/site/types";
import {
  DEFAULT_EVENT_TITLES,
  previewPhase,
  toPublicContent,
  toSensitiveContent,
  toWorkingSet,
} from "./content";
import { createDraft, withLocales, type WizardDraft } from "./draft";

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const now = new Date("2026-10-02T10:00:00Z");

function base(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return {
    ...createDraft({ locale: "cs", partnerA: "Klára", partnerB: "Matěj", newId, now }),
    startsOn: "2027-06-19",
    ...overrides,
  };
}

function full(): WizardDraft {
  return base({
    ceremony: {
      enabled: true,
      time: "14:00",
      venueName: "Zámecká kaple",
      venueAddress: "Zámecká 1, Dobřichovice",
      directions: { cs: "Parkování na nádvoří." },
      geo: null,
    },
    reception: {
      enabled: true,
      time: "16:30",
      venueName: "",
      venueAddress: "",
      directions: {},
      geo: null,
      sameVenue: true,
    },
    extraEvents: [{ id: newId(), title: { cs: "Raut" }, time: "15:00" }],
    dressCode: { cs: "Slavnostní, bez bílé." },
    lodging: [
      {
        id: newId(),
        name: "Penzion U Řeky",
        description: { cs: "Snídaně v ceně." },
        url: "www.penzion.cz",
      },
    ],
    transport: { cs: "Vlak každou půlhodinu." },
    contacts: [{ id: newId(), name: "Eva", email: "eva@example.cz", phone: "777-123-456" }],
    rsvp: {
      deadline: "2027-05-01",
      plusOne: true,
      children: true,
      diet: false,
      emailConfirmation: true,
    },
  });
}

describe("toPublicContent", () => {
  it("minimální koncept (kroky 1 až 3) dá platný web s úvodem a potvrzením účasti", () => {
    const content = toPublicContent(base(), { slug: "klara-a-matej" });
    expect(publicContentSchema.safeParse(content).success).toBe(true);
    expect(content.slug).toBe("klara-a-matej");
    expect(content.partners).toEqual({ a: "Klára", b: "Matěj" });
    expect(content.blocks.map((b) => b.type)).toEqual(["hero", "rsvp"]);
    expect(content.events).toEqual([]);
    expect(content.venues).toEqual([]);
    expect(content.template).toBe("eukalyptus");
  });

  it("úplný koncept: program, místo, ubytování, dress code, kontakt", () => {
    const content = toPublicContent(full(), { slug: "klara-a-matej" });
    expect(content.blocks.map((b) => b.type)).toEqual([
      "hero",
      "program",
      "venue",
      "lodging",
      "dresscode",
      "contact",
      "rsvp",
    ]);
    expect(content.blocks.map((b) => b.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(content.blocks.map((b) => b.anchor)).size).toBe(7);

    // události seřazené podle času, obřad s místem, hostina na stejném místě
    expect(content.events.map((e) => [e.kind, e.startsAt])).toEqual([
      ["ceremony", "2027-06-19T14:00:00+02:00"],
      ["other", "2027-06-19T15:00:00+02:00"],
      ["reception", "2027-06-19T16:30:00+02:00"],
    ]);
    expect(content.venues).toHaveLength(1);
    const ceremony = content.events.find((e) => e.kind === "ceremony");
    const reception = content.events.find((e) => e.kind === "reception");
    expect(ceremony?.venueId).toBe(content.venues[0].id);
    expect(reception?.venueId).toBe(content.venues[0].id);
    expect(content.venues[0].directions).toEqual({ cs: "Parkování na nádvoří." });

    const lodging = content.blocks.find((b) => b.type === "lodging");
    expect(lodging?.type === "lodging" && lodging.data.items[0].url).toBe(
      "https://www.penzion.cz/",
    );
    const contact = content.blocks.find((b) => b.type === "contact");
    expect(contact?.type === "contact" && contact.data.people[0]).toMatchObject({
      name: "Eva",
      email: "eva@example.cz",
      phone: "777 123 456",
    });
  });

  it("názvy obřadu a hostiny jsou ve všech jazycích webu", () => {
    const draft = withLocales(full(), ["cs", "en"], "cs");
    const content = toPublicContent(draft, { slug: "x-a-y" });
    const ceremony = content.events.find((e) => e.kind === "ceremony");
    expect(ceremony?.title).toEqual(DEFAULT_EVENT_TITLES.ceremony);
  });

  it("nehotové položky se vynechají (událost bez času, místo bez adresy)", () => {
    const draft = base({
      ceremony: {
        enabled: true,
        time: "",
        venueName: "Kaple",
        venueAddress: "",
        directions: {},
        geo: null,
      },
      extraEvents: [{ id: newId(), title: {}, time: "15:00" }],
      lodging: [{ id: newId(), name: "", description: {}, url: "" }],
      contacts: [{ id: newId(), name: "", email: "", phone: "" }],
    });
    const content = toPublicContent(draft, { slug: "klara-a-matej" });
    expect(content.events).toEqual([]);
    expect(content.venues).toEqual([]);
    expect(content.blocks.map((b) => b.type)).toEqual(["hero", "rsvp"]);
  });

  it("hostina s vlastním místem a vypnutý obřad", () => {
    const draft = base({
      reception: {
        enabled: true,
        time: "17:00",
        venueName: "Sál",
        venueAddress: "Hlavní 5",
        directions: { cs: "Vchod z dvora." },
        geo: null,
        sameVenue: true,
      },
    });
    const content = toPublicContent(draft, { slug: "klara-a-matej" });
    expect(content.venues).toHaveLength(1);
    expect(content.events[0].venueId).toBe(content.venues[0].id);
  });

  it("zástupné hodnoty pro prázdný koncept (živý náhled)", () => {
    const empty = createDraft({ locale: "cs", newId, now });
    expect(() => toPublicContent(empty, { slug: "x" })).toThrow();
    const content = toPublicContent(empty, { placeholders: true, now });
    expect(content.partners).toEqual({ a: "Jméno", b: "Jméno" });
    expect(content.startsOn).toBe("2027-03-31");
    expect(content.slug).toBe("nahled");
  });

  it("vícedenní svatba má konec, neplatný konec se zahodí", () => {
    expect(toPublicContent(base({ endsOn: "2027-06-20" }), { slug: "aaa" }).endsOn).toBe(
      "2027-06-20",
    );
    expect(toPublicContent(base({ endsOn: "2027-06-01" }), { slug: "aaa" }).endsOn).toBeNull();
  });

  it("výsledek se vykreslí: bloky pro vykreslení odpovídají obsahu", async () => {
    const content = toPublicContent(full(), { slug: "klara-a-matej", phase: "rsvp_open" });
    const ctx = createSiteCtx(content, await getTranslator("cs", SITE_NAMESPACES), { now });
    expect(renderableBlocks(ctx).map((b) => b.type)).toEqual([
      "hero",
      "program",
      "venue",
      "lodging",
      "dresscode",
      "contact",
      "rsvp",
    ]);
  });

  it("každá paleta každé šablony prochází validatePalette (nic neprojde bez kontroly kontrastu)", () => {
    for (const template of ["editorial", "eukalyptus", "chateau", "modern"] as const) {
      const draft = base({ template });
      draft.palette = getPalette(template, draft.palette).key;
      expect(validatePalette(getPalette(draft.template, draft.palette)).ok).toBe(true);
    }
  });

  it("obsah za PINem je prázdný (průvodce žádný nemá)", () => {
    expect(toSensitiveContent()).toEqual({ venues: {}, gifts: null, gallery: null, photos: [] });
  });
});

describe("mapa místa", () => {
  const geo = {
    query: "Zámecká 1, Dobřichovice",
    lat: 49.92556,
    lng: 14.27639,
    label: "Zámecká 1",
  };

  it("souřadnice platí jen k adrese, ke které se hledaly; volba mapy jde do bloku", () => {
    const draft = full();
    const located = toPublicContent(
      { ...draft, showMap: true, ceremony: { ...draft.ceremony, geo } },
      { slug: "klara-a-matej" },
    );
    expect(located.venues[0]).toMatchObject({ lat: 49.92556, lng: 14.27639 });
    const block = located.blocks.find((b) => b.type === "venue");
    expect(block?.type === "venue" && block.data.showMap).toBe(true);

    const stale = toPublicContent(
      {
        ...draft,
        showMap: true,
        ceremony: { ...draft.ceremony, venueAddress: "Hlavní 5, Praha", geo },
      },
      { slug: "klara-a-matej" },
    );
    expect(stale.venues[0]).toMatchObject({ lat: null, lng: null });
  });

  it("pracovní sada nese souřadnice", () => {
    const draft = full();
    const work = toWorkingSet({ ...draft, ceremony: { ...draft.ceremony, geo } }, now);
    expect(work.venues[0]).toMatchObject({ lat: 49.92556, lng: 14.27639 });
  });
});

describe("toWorkingSet", () => {
  it("zrcadlí obsah webu a nastavení potvrzení účasti", () => {
    const set = toWorkingSet({ ...full(), guestPin: { enabled: true, pin: "482915" } }, now);
    expect(set.wedding).toMatchObject({
      partnerA: "Klára",
      partnerB: "Matěj",
      startsOn: "2027-06-19",
      endsOn: null,
      timezone: "Europe/Prague",
      locales: ["cs"],
      defaultLocale: "cs",
      template: "eukalyptus",
      palette: "bordo",
      guestPinEnabled: true,
    });
    expect(set.venues).toHaveLength(1);
    expect(set.events.map((e) => [e.kind, e.rsvpEnabled])).toEqual([
      ["ceremony", true],
      ["other", false],
      ["reception", true],
    ]);
    expect(set.blocks).toHaveLength(7);
    expect(set.rsvp).toEqual({
      opensAt: null,
      closesAt: "2027-05-01T23:59:59+02:00",
      allowUnlisted: false,
      emailConfirmation: true,
      questions: { plus_one: true, children: true, diet: false },
    });
    // PIN v prostém tvaru se do pracovní sady nikdy nedostane
    expect(JSON.stringify(set)).not.toContain("482915");
  });

  it("bez uzávěrky je closesAt null", () => {
    expect(toWorkingSet(base(), now).rsvp.closesAt).toBeNull();
  });
});

describe("previewPhase", () => {
  it("fáze konceptového náhledu podle data a uzávěrky", () => {
    expect(previewPhase(base({ startsOn: "" }), now)).toBe("rsvp_open");
    expect(previewPhase(base(), now)).toBe("rsvp_open");
    expect(previewPhase(base({ startsOn: "2026-10-02" }), now)).toBe("wedding_day");
    expect(previewPhase(base({ startsOn: "2026-09-01" }), now)).toBe("thanks");
    expect(previewPhase(base({ startsOn: "2026-09-30", endsOn: "2026-10-03" }), now)).toBe(
      "wedding_day",
    );
    const closed = base({
      startsOn: "2026-12-01",
      rsvp: {
        deadline: "2026-10-01",
        plusOne: false,
        children: false,
        diet: false,
        emailConfirmation: false,
      },
    });
    expect(previewPhase(closed, now)).toBe("rsvp_closed");
  });
});
