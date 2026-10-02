import { describe, expect, it } from "vitest";
import {
  canPublish,
  canSaveToServer,
  createDraft,
  issuesForSteps,
  parseDraft,
  serverDraft,
  stepState,
  validateDraft,
  withLocales,
  withNames,
  withTemplate,
  wizardDraftSchema,
  type WizardDraft,
} from "./draft";

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const now = new Date("2026-10-02T10:00:00Z");

function complete(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return {
    ...createDraft({ locale: "cs", partnerA: "Klára", partnerB: "Matěj", newId, now }),
    startsOn: "2027-06-19",
    ...overrides,
  };
}

describe("createDraft", () => {
  it("předvyplní jména a jazyk z úvodní stránky a odvodí adresu", () => {
    const draft = createDraft({
      locale: "cs",
      siteLocale: "en",
      partnerA: "  Klára  ",
      partnerB: "Matěj",
      newId,
      now,
    });
    expect(draft.partnerA).toBe("Klára");
    expect(draft.locales).toEqual(["en"]);
    expect(draft.defaultLocale).toBe("en");
    expect(draft.slug).toBe("klara-and-matej");
    expect(draft.template).toBe("eukalyptus");
    expect(draft.palette).toBe("stribrna");
    expect(wizardDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("každé volání dá jiné identifikátory a jména ořízne na limit", () => {
    const a = createDraft({ locale: "cs", partnerA: "x".repeat(200) });
    const b = createDraft({ locale: "cs" });
    expect(a.partnerA.length).toBe(60);
    expect(a.ids.hero).not.toBe(b.ids.hero);
  });
});

describe("parseDraft", () => {
  it("vrací null pro poškozená data", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft({ version: 2 })).toBeNull();
    expect(parseDraft("nesmysl")).toBeNull();
    expect(parseDraft({ ...complete(), template: "neexistuje" })).toBeNull();
  });

  it("sjednotí paletu a výchozí jazyk", () => {
    const parsed = parseDraft({
      ...complete(),
      palette: "cizi",
      locales: ["en"],
      defaultLocale: "cs",
    });
    expect(parsed?.palette).toBe("stribrna");
    expect(parsed?.defaultLocale).toBe("en");
  });

  it("zavrhne obří texty (obrana proti zahlcení)", () => {
    expect(parseDraft({ ...complete(), dressCode: { cs: "x".repeat(5000) } })).toBeNull();
  });
});

describe("pomocné změny", () => {
  it("změna šablony vrátí výchozí paletu nové šablony", () => {
    const next = withTemplate({ ...complete(), palette: "hloubka" }, "chateau");
    expect(next.template).toBe("chateau");
    expect(next.palette).toBe("champagne");
    expect(withTemplate(next, "chateau")).toBe(next);
  });

  it("adresa se odvozuje z jmen, dokud ji pár ručně neupraví", () => {
    const base = complete();
    expect(withNames(base, "Eva", "Adam").slug).toBe("eva-a-adam");
    const edited = withNames({ ...base, slug: "nase-svatba", slugEdited: true }, "Eva", "Adam");
    expect(edited.slug).toBe("nase-svatba");
  });

  it("jazyky webu: nejméně jeden, výchozí mezi nimi", () => {
    const base = complete();
    expect(withLocales(base, ["cs", "en"], "en").locales).toEqual(["cs", "en"]);
    expect(withLocales(base, [], "en")).toMatchObject({ locales: ["en"], defaultLocale: "en" });
    expect(withLocales(base, ["cs"], "en").defaultLocale).toBe("cs");
  });

  it("serverDraft nikdy neposílá PIN v prostém tvaru ani měření", () => {
    const server = serverDraft({
      ...complete(),
      guestPin: { enabled: true, pin: "482915" },
      tracking: { started: true, steps: [1, 2] },
    });
    expect(server.guestPin).toEqual({ enabled: true, pin: "" });
    expect(JSON.stringify(server)).not.toContain("482915");
    expect(server.tracking).toEqual({ started: false, steps: [] });
  });
});

describe("validateDraft", () => {
  it("úplný koncept kroků 1 až 3 je uložitelný i zveřejnitelný", () => {
    const draft = complete();
    expect(validateDraft(draft)).toEqual([]);
    expect(canSaveToServer(draft)).toBe(true);
    expect(canPublish(draft)).toBe(true);
  });

  it("chybí jména, datum a adresa", () => {
    const draft = complete({ partnerA: " ", partnerB: "", startsOn: "", slug: "" });
    const codes = validateDraft(draft).map((i) => i.code);
    expect(codes).toEqual(["partner_required", "partner_required", "date_required", "slug_empty"]);
    expect(canSaveToServer(draft)).toBe(false);
  });

  it("neexistující datum, konec před začátkem", () => {
    expect(validateDraft(complete({ startsOn: "2027-02-30" })).map((i) => i.code)).toContain(
      "date_invalid",
    );
    const issues = validateDraft(complete({ endsOn: "2027-06-18" }));
    expect(issues.map((i) => i.code)).toContain("end_before_start");
    expect(validateDraft(complete({ endsOn: "2027-06-20" }))).toEqual([]);
  });

  it("adresa: rezervované slovo, příliš krátká, špatný tvar", () => {
    expect(validateDraft(complete({ slug: "admin" })).map((i) => i.code)).toEqual([
      "slug_reserved",
    ]);
    expect(validateDraft(complete({ slug: "ab" })).map((i) => i.code)).toEqual(["slug_too_short"]);
    expect(validateDraft(complete({ slug: "a--b" })).map((i) => i.code)).toEqual(["slug_format"]);
  });

  it("paleta s nízkým kontrastem nejde zveřejnit (validatePalette)", () => {
    const draft = complete({ palette: "neexistuje" });
    expect(validateDraft(draft).map((i) => i.code)).toEqual(["palette_invalid"]);
  });

  it("kroky 4 až 7 jsou nepovinné, ale rozepsaná položka musí být úplná", () => {
    const draft = complete({
      ceremony: { enabled: true, time: "", venueName: "Kaple", venueAddress: "", directions: {} },
      extraEvents: [{ id: newId(), title: {}, time: "25:00" }],
      lodging: [{ id: newId(), name: "", description: {}, url: "javascript:alert(1)" }],
      contacts: [{ id: newId(), name: "", email: "neni-email", phone: "abc" }],
      rsvp: {
        deadline: "2027-07-01",
        plusOne: false,
        children: false,
        diet: false,
        emailConfirmation: false,
      },
    });
    const codes = validateDraft(draft).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "time_required",
        "place_incomplete",
        "extra_title_required",
        "time_invalid",
        "lodging_name_required",
        "url_invalid",
        "contact_name_required",
        "contact_email_invalid",
        "contact_phone_invalid",
        "deadline_after_start",
      ]),
    );
    expect(canPublish(draft)).toBe(false);
    // kroky 1 až 3 jsou přitom v pořádku, takže koncept jde uložit
    expect(canSaveToServer(draft)).toBe(true);
  });

  it("hostina na stejném místě jako obřad nevyžaduje vlastní místo", () => {
    const draft = complete({
      ceremony: {
        enabled: true,
        time: "14:00",
        venueName: "Kaple",
        venueAddress: "Zámecká 1",
        directions: {},
      },
      reception: {
        enabled: true,
        time: "16:00",
        venueName: "",
        venueAddress: "",
        directions: {},
        sameVenue: true,
      },
    });
    expect(validateDraft(draft)).toEqual([]);
  });

  it("PIN hostů: povinný, formát a triviální hodnoty", () => {
    const base = complete();
    const codes = (pin: string) =>
      validateDraft({ ...base, guestPin: { enabled: true, pin } }).map((i) => i.code);
    expect(codes("")).toEqual(["pin_required"]);
    expect(codes("123")).toEqual(["pin_format"]);
    expect(codes("111111")).toEqual(["pin_trivial"]);
    expect(codes("482915")).toEqual([]);
    expect(validateDraft({ ...base, guestPin: { enabled: false, pin: "" } })).toEqual([]);
  });

  it("issuesForSteps vrací jen chyby daných kroků", () => {
    const draft = complete({ partnerA: "", startsOn: "" });
    expect(issuesForSteps(draft, [1]).map((i) => i.field)).toEqual(["partnerA"]);
    expect(issuesForSteps(draft, [2]).map((i) => i.field)).toEqual(["startsOn"]);
  });
});

describe("stepState", () => {
  it("hotový, přeskočený, s chybou a nenavštívený krok", () => {
    const base = complete({
      progress: { step: 6, reached: 6, skipped: [4], done: [1, 2, 3, 5] },
    });
    expect(stepState(base, 1)).toBe("done");
    expect(stepState(base, 4)).toBe("skipped");
    expect(stepState(base, 5)).toBe("done");
    expect(stepState(base, 7)).toBe("todo");
    const broken = { ...base, startsOn: "" };
    expect(stepState(broken, 2)).toBe("invalid");
    // nenavštívený krok s chybou se nehlásí jako chybný
    const early = complete({
      startsOn: "",
      progress: { step: 1, reached: 1, skipped: [], done: [] },
    });
    expect(stepState(early, 2)).toBe("todo");
  });
});
