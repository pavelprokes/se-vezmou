import { describe, expect, it } from "vitest";
import {
  answerField,
  attendanceField,
  buildListedModel,
  buildUnlistedModel,
  extraField,
  fieldId,
  guestField,
} from "./form";
import {
  ALL_FLAGS,
  E_HOSTINA,
  E_OBRAD,
  G_ANEZKA,
  G_JAN,
  G_MARIE,
  householdView,
  unlistedView,
} from "./test-fixtures";

describe("model formuláře domácnosti (FR-RSVP-2, FR-RSVP-3)", () => {
  it("ptá se každého jen na pozvané události", () => {
    const model = buildListedModel(householdView(), "cs");
    expect(model.mode).toBe("listed");
    expect(model.guests.map((g) => [g.name, g.eventIds])).toEqual([
      ["Jan Novák", [E_OBRAD, E_HOSTINA]],
      ["Marie Nováková", [E_OBRAD, E_HOSTINA]],
      ["Anežka Nováková", [E_OBRAD]],
    ]);
    expect(model.guests[2]).toMatchObject({ isChild: true, age: 9 });
    expect(model.events.map((e) => e.title)).toEqual(["Svatební obřad", "Svatební hostina"]);
    expect(model.existing).toBe(false);
  });

  it("příznaky otázek a e-mailu podle nastavení páru", () => {
    expect(buildListedModel(householdView(), "cs").flags).toEqual({
      plusOne: true,
      children: true,
      diet: true,
      lodging: true,
      transport: true,
      song: true,
      emailConfirmation: true,
    });
    const minimal = buildListedModel(
      householdView({ settings: { enabled_questions: {}, email_confirmation: false } }),
      "cs",
    );
    expect(Object.values(minimal.flags).every((v) => v === false)).toBe(true);
    // chybějící nastavení = vše vypnuto
    expect(buildListedModel(householdView({ settings: null }), "cs").flags.plusOne).toBe(false);
    // jen výslovné true zapíná (řetězec nebo číslo ne)
    expect(
      buildListedModel(
        householdView({
          settings: { enabled_questions: { diet: "true", song: 1 }, email_confirmation: false },
        }),
        "cs",
      ).flags,
    ).toMatchObject({ diet: false, song: false });
  });

  it("texty událostí jsou v jazyce stránky s náhradním jazykem a čas je v pásmu svatby", () => {
    const cs = buildListedModel(householdView(), "cs");
    const en = buildListedModel(householdView(), "en");
    expect(cs.events[0].title).toBe("Svatební obřad");
    expect(en.events[0].title).toBe("Wedding ceremony");
    // popis hostiny je jen česky: v angličtině se ukáže česky (náhradní jazyk), `lang` to označí u titulku jen když chybí titulek
    expect(en.events[1].description).toBe("Menu zahrnuje vegetariánskou variantu.");
    // 12:00 UTC je v červnu 14:00 pražského času
    expect(cs.events[0].when).toMatch(/19\.\sčervna\s2027.*14:00/);
    expect(en.events[0].when).toMatch(/19\sJune\s2027.*14:00/);
    const onlyCs = buildListedModel(
      householdView({
        events: [{ ...householdView().events[0], title: { cs: "Jen česky" } }],
      }),
      "en",
    );
    expect(onlyCs.events[0].title).toBe("Jen česky");
    expect(onlyCs.events[0].titleLang).toBe("cs");
    expect(en.events[0].titleLang).toBeUndefined();
  });

  it("host bez hodnot zdravotních údajů a e-mailu dostane jen příznaky, že jsou uložené", () => {
    const person = (guestId: string | null, name: string) => ({
      guest_id: guestId,
      person_name: name,
      is_plus_one: guestId === null,
      is_child: false,
      age: null,
      attendance: [{ event_id: E_OBRAD, attending: true }],
      diet: null,
      allergies: null,
      has_health: true,
    });
    const model = buildListedModel(
      householdView({
        response: {
          answers: {},
          contact_email: null,
          has_email: true,
          entered_by: "guest",
          people: [person(G_JAN, "Jan Novák"), person(null, "Tereza Doprovodová")],
        },
      }),
      "cs",
    );
    expect(model.values.diet[guestField(G_JAN)]).toBeUndefined();
    expect(model.values.savedHealth).toEqual({ [guestField(G_JAN)]: true });
    expect(model.values.extras[0].savedHealth).toBe(true);
    expect(model.values.email).toBe("");
    expect(model.values.savedEmail).toBe(true);
  });

  it("předvyplní dřívější odpověď včetně doprovodu, dítěte, otázek a e-mailu", () => {
    const model = buildListedModel(
      householdView({
        response: {
          answers: { lodging: "need", song: "Vlak do nebe", prekvapeni: true },
          contact_email: "jan@example.test",
          entered_by: "guest",
          people: [
            {
              guest_id: G_JAN,
              person_name: "Jan Novák",
              is_plus_one: false,
              is_child: false,
              age: null,
              attendance: [
                { event_id: E_OBRAD, attending: true },
                { event_id: E_HOSTINA, attending: false },
              ],
              diet: "bezlepková",
              allergies: null,
            },
            {
              guest_id: null,
              person_name: "Tereza Doprovodová",
              is_plus_one: true,
              is_child: false,
              age: null,
              attendance: [{ event_id: E_OBRAD, attending: true }],
              diet: null,
              allergies: "ořechy",
            },
            {
              guest_id: null,
              person_name: "Matyáš",
              is_plus_one: false,
              is_child: true,
              age: 4,
              attendance: [],
              diet: null,
              allergies: null,
            },
          ],
        },
      }),
      "cs",
    );
    expect(model.existing).toBe(true);
    expect(model.values.attendance[attendanceField(guestField(G_JAN), E_OBRAD)]).toBe("yes");
    expect(model.values.attendance[attendanceField(guestField(G_JAN), E_HOSTINA)]).toBe("no");
    expect(model.values.diet[guestField(G_JAN)]).toBe("bezlepková");
    expect(model.values.extras).toEqual([
      {
        kind: "adult",
        name: "Tereza Doprovodová",
        age: "",
        attendance: { [E_OBRAD]: "yes" },
        diet: "",
        allergies: "ořechy",
      },
      { kind: "child", name: "Matyáš", age: "4", attendance: {}, diet: "", allergies: "" },
    ]);
    expect(model.values.answers).toEqual({
      lodging: "need",
      song: "Vlak do nebe",
      prekvapeni: "yes",
    });
    expect(model.values.email).toBe("jan@example.test");
  });

  it("vlastní otázky: výběr s platnými možnostmi, ano/ne, text; vadné možnosti se zahodí", () => {
    const model = buildListedModel(
      householdView({
        questions: [
          {
            id: "q1",
            key: "menu",
            type: "choice",
            label: { cs: "Menu", en: "Menu" },
            options: [
              { value: "maso", label: { cs: "Maso", en: "Meat" } },
              { value: "", label: { cs: "Prázdná hodnota" } },
              { label: { cs: "Bez hodnoty" } },
              "řetězec",
              { value: "ryba", label: { cs: "Ryba", de: "Fisch" } },
              { value: "vege", label: { cs: "Vegetariánské" } },
            ],
            required: true,
            event_id: E_HOSTINA,
          },
          {
            id: "q2",
            key: "prazdny",
            type: "choice",
            label: { cs: "Bez možností" },
            options: [],
            required: false,
            event_id: null,
          },
          {
            id: "q3",
            key: "bool",
            type: "bool",
            label: { cs: "Ano nebo ne" },
            options: null,
            required: false,
            event_id: null,
          },
          {
            id: "q4",
            key: "text",
            type: "text",
            label: { cs: "Text" },
            options: null,
            required: true,
            event_id: null,
          },
        ],
      }),
      "en",
    );
    expect(model.questions.map((q) => q.key)).toEqual(["menu", "bool", "text"]);
    const menu = model.questions[0];
    // možnost s neplatným klíčem jazyka `de` se zahodí celá, ostatní zůstanou
    expect(menu.options).toEqual([
      { value: "maso", label: "Meat" },
      { value: "vege", label: "Vegetariánské" },
    ]);
    expect(menu).toMatchObject({ required: true, eventId: E_HOSTINA });
    expect(model.questions[2].required).toBe(true);
  });
});

describe("model hosta mimo seznam (FR-RSVP-7)", () => {
  it("nemá hosty, první osoba je prázdný dospělý a ptá se na všechny události formuláře", () => {
    const model = buildUnlistedModel(unlistedView(), "cs");
    expect(model.mode).toBe("unlisted");
    expect(model.guests).toEqual([]);
    expect(model.events).toHaveLength(2);
    expect(model.values.extras).toHaveLength(1);
    expect(model.values.extras[0]).toMatchObject({ kind: "adult", name: "" });
    expect(model.flags).toMatchObject({ children: true, diet: true, plusOne: false });
    expect(model.existing).toBe(false);
  });
});

describe("názvy polí", () => {
  it("jsou jediné místo, které zná klient i server", () => {
    expect(guestField(G_MARIE)).toBe(`g.${G_MARIE}`);
    expect(attendanceField(guestField(G_ANEZKA), E_OBRAD)).toBe(`g.${G_ANEZKA}.ev.${E_OBRAD}`);
    expect(extraField(2)).toBe("x.2");
    expect(answerField("menu")).toBe("a.menu");
  });

  it("id prvku je platný identifikátor a z různých polí vzniká různé", () => {
    const ids = ["g.abc.ev.def", "x.0.name", "x.0.age", "a.menu", "email", `g.${G_JAN}.diet`].map(
      fieldId,
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^rsvp-[A-Za-z0-9-]+$/);
  });

  it("vestavěné příznaky jsou celá sada", () => {
    expect(Object.keys(ALL_FLAGS).sort()).toEqual(
      ["children", "diet", "lodging", "plus_one", "song", "transport"].sort(),
    );
  });
});
