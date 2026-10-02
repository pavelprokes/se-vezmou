import { describe, expect, it } from "vitest";
import { buildListedModel, buildUnlistedModel, type RsvpFormModel } from "./form";
import { parseSubmission } from "./submission";
import {
  E_HOSTINA,
  E_OBRAD,
  formOf,
  G_ANEZKA,
  G_JAN,
  G_MARIE,
  householdView,
  unlistedView,
} from "./test-fixtures";

const g = (id: string, event: string) => `g.${id}.ev.${event}`;

/** Odpovědi všech hostů domácnosti: Jan a Marie přijdou na vše, Anežka jen na obřad. */
const everyone: [string, string][] = [
  [g(G_JAN, E_OBRAD), "yes"],
  [g(G_JAN, E_HOSTINA), "yes"],
  [g(G_MARIE, E_OBRAD), "yes"],
  [g(G_MARIE, E_HOSTINA), "no"],
  [g(G_ANEZKA, E_OBRAD), "yes"],
];

function listed(overrides = {}): RsvpFormModel {
  return buildListedModel(householdView(overrides), "cs");
}

describe("odeslání domácnosti: obsah pro databázi", () => {
  it("složí osoby a účast jen z pozvaných událostí a z modelu, ne z formuláře", () => {
    const result = parseSubmission(formOf(everyone), listed());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.people.map((p) => [p.guest_id, p.attendance.length])).toEqual([
      [G_JAN, 2],
      [G_MARIE, 2],
      [G_ANEZKA, 1],
    ]);
    expect(result.payload.people[1].attendance).toEqual([
      { event_id: E_OBRAD, attending: true },
      { event_id: E_HOSTINA, attending: false },
    ]);
    expect(result.payload.contact_email).toBeNull();
    expect(result.summary.unlisted).toBe(false);
    expect(result.summary.people[1]).toEqual({
      name: "Marie Nováková",
      rows: [
        { event: "Svatební obřad", attending: true },
        { event: "Svatební hostina", attending: false },
      ],
    });
  });

  it("odpověď na událost, na kterou host není pozván, se ignoruje (klient nic nepřidá)", () => {
    const result = parseSubmission(
      formOf([...everyone, [g(G_ANEZKA, E_HOSTINA), "yes"], ["g.cizi-host.ev." + E_OBRAD, "yes"]]),
      listed(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.people).toHaveLength(3);
    expect(result.payload.people[2].attendance).toEqual([{ event_id: E_OBRAD, attending: true }]);
  });

  it("chybějící odpověď u pozvané události je chyba u přesného pole", () => {
    const result = parseSubmission(formOf(everyone.slice(0, 3)), listed());
    expect(result).toEqual({
      ok: false,
      errors: {
        [g(G_MARIE, E_HOSTINA)]: "required",
        [g(G_ANEZKA, E_OBRAD)]: "required",
      },
    });
    // hodnota mimo yes/no se bere jako nevyplněná
    const bad = parseSubmission(
      formOf([...everyone.slice(0, 4), [g(G_ANEZKA, E_OBRAD), "možná"]]),
      listed(),
    );
    expect(bad).toEqual({ ok: false, errors: { [g(G_ANEZKA, E_OBRAD)]: "required" } });
  });

  it("zdravotní údaje: jen při zapnuté dietě, oříznuté, prázdné se nepošlou, příliš dlouhé jsou chyba", () => {
    const withDiet = parseSubmission(
      formOf([
        ...everyone,
        [`g.${G_JAN}.diet`, "  bezlepková  "],
        [`g.${G_JAN}.allergies`, ""],
        [`g.${G_MARIE}.allergies`, "ořechy"],
      ]),
      listed(),
    );
    expect(withDiet.ok && withDiet.payload.people[0]).toMatchObject({ diet: "bezlepková" });
    expect(withDiet.ok && "allergies" in withDiet.payload.people[0]).toBe(false);
    expect(withDiet.ok && withDiet.payload.people[1].allergies).toBe("ořechy");

    const off = parseSubmission(
      formOf([...everyone, [`g.${G_JAN}.diet`, "bezlepková"]]),
      listed({ settings: { enabled_questions: {}, email_confirmation: false } }),
    );
    expect(off.ok && "diet" in off.payload.people[0]).toBe(false);

    const tooLong = parseSubmission(
      formOf([...everyone, [`g.${G_JAN}.diet`, "x".repeat(1001)]]),
      listed(),
    );
    expect(tooLong).toEqual({ ok: false, errors: { [`g.${G_JAN}.diet`]: "too_long" } });
  });

  it("zdravotní údaje nejsou v souhrnu pro potvrzení (ten jde i do e-mailu)", () => {
    const result = parseSubmission(
      formOf([...everyone, [`g.${G_JAN}.diet`, "bezlepková"], [`g.${G_JAN}.allergies`, "ořechy"]]),
      listed(),
    );
    expect(JSON.stringify(result.ok && result.summary)).not.toMatch(
      /bezlepková|ořechy|diet|allerg/i,
    );
  });
});

describe("doprovod a děti", () => {
  const plus: [string, string][] = [
    ["x.0.kind", "adult"],
    ["x.0.name", " Tereza Doprovodová "],
    [`x.0.ev.${E_OBRAD}`, "yes"],
    [`x.0.ev.${E_HOSTINA}`, "no"],
  ];
  const child: [string, string][] = [
    ["x.1.kind", "child"],
    ["x.1.name", "Matyáš"],
    ["x.1.age", "4"],
    [`x.1.ev.${E_OBRAD}`, "yes"],
    [`x.1.ev.${E_HOSTINA}`, "no"],
  ];

  it("plus jedna se jménem a dítě s věkem se zapíšou jako osoby bez hosta", () => {
    const result = parseSubmission(formOf([...everyone, ...plus, ...child]), listed());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [, , , adult, kid] = result.payload.people;
    expect(adult).toMatchObject({ guest_id: null, person_name: "Tereza Doprovodová" });
    expect(adult.is_child).toBeUndefined();
    expect(kid).toMatchObject({ guest_id: null, person_name: "Matyáš", is_child: true, age: 4 });
    expect(adult.attendance).toHaveLength(2);
  });

  it("jméno je povinné, dítě potřebuje věk 0 až 17, účast se vybírá u každé události", () => {
    const result = parseSubmission(
      formOf([
        ...everyone,
        ["x.0.kind", "adult"],
        ["x.0.name", "   "],
        ["x.1.kind", "child"],
        ["x.1.name", "Matyáš"],
        ["x.1.age", "18"],
        [`x.1.ev.${E_OBRAD}`, "yes"],
      ]),
      listed(),
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        "x.0.name": "name",
        [`x.0.ev.${E_OBRAD}`]: "required",
        [`x.0.ev.${E_HOSTINA}`]: "required",
        "x.1.age": "age",
        [`x.1.ev.${E_HOSTINA}`]: "required",
      },
    });
    for (const age of ["", "abc", "-1", "4.5", "100", "1e1"]) {
      const bad = parseSubmission(
        formOf([
          ...everyone,
          ...child.map(([n, v]): [string, string] => [n, n === "x.1.age" ? age : v]),
        ]),
        listed(),
      );
      expect(bad.ok, `věk "${age}"`).toBe(false);
    }
    const adult0 = parseSubmission(
      formOf([
        ...everyone,
        ...child.map(([n, v]): [string, string] => [n, n === "x.1.age" ? "0" : v]),
      ]),
      listed(),
    );
    expect(adult0.ok).toBe(true);
  });

  it("nejvýš jeden doprovod a jen když ho pár povolil", () => {
    const two = parseSubmission(
      formOf([
        ...everyone,
        ...plus,
        ["x.1.kind", "adult"],
        ["x.1.name", "Druhý Doprovod"],
        [`x.1.ev.${E_OBRAD}`, "yes"],
        [`x.1.ev.${E_HOSTINA}`, "yes"],
      ]),
      listed(),
    );
    expect(two).toEqual({ ok: false, errors: { "x.1.kind": "invalid" } });

    const off = parseSubmission(
      formOf([...everyone, ...plus]),
      listed({ settings: { enabled_questions: { children: true }, email_confirmation: false } }),
    );
    expect(off).toEqual({ ok: false, errors: { "x.0.kind": "invalid" } });

    const noChildren = parseSubmission(
      formOf([...everyone, ...child]),
      listed({ settings: { enabled_questions: { plus_one: true }, email_confirmation: false } }),
    );
    expect(noChildren).toEqual({ ok: false, errors: { "x.1.kind": "invalid" } });
  });

  it("neplatný druh osoby se bere jako dospělý, ne jako cokoli jiného", () => {
    const result = parseSubmission(
      formOf([
        ...everyone,
        ...plus.map(([n, v]): [string, string] => [n, n === "x.0.kind" ? "admin" : v]),
      ]),
      listed(),
    );
    expect(result.ok && result.payload.people[3].is_child).toBeUndefined();
  });
});

describe("otázky a e-mail", () => {
  const questions = [
    {
      id: "q1",
      key: "menu",
      type: "choice" as const,
      label: { cs: "Menu" },
      options: [
        { value: "maso", label: { cs: "Maso" } },
        { value: "ryba", label: { cs: "Ryba" } },
      ],
      required: true,
      event_id: null,
    },
    {
      id: "q2",
      key: "tanec",
      type: "text" as const,
      label: { cs: "Tanec" },
      options: null,
      required: false,
      event_id: E_HOSTINA,
    },
    {
      id: "q3",
      key: "prekvapeni",
      type: "bool" as const,
      label: { cs: "Překvapení" },
      options: null,
      required: false,
      event_id: null,
    },
  ];

  it("vestavěné otázky se čtou jen při zapnutí a kontrolují možnosti", () => {
    const ok = parseSubmission(
      formOf([
        ...everyone,
        ["a.lodging", "need"],
        ["a.transport", "offer"],
        ["a.song", "  Vlak do nebe "],
      ]),
      listed(),
    );
    expect(ok.ok && ok.payload.answers).toEqual({
      lodging: "need",
      transport: "offer",
      song: "Vlak do nebe",
    });

    const bad = parseSubmission(
      formOf([...everyone, ["a.lodging", "hotel"], ["a.song", "x".repeat(201)]]),
      listed(),
    );
    expect(bad).toEqual({ ok: false, errors: { "a.lodging": "choice", "a.song": "too_long" } });

    const off = parseSubmission(
      formOf([...everyone, ["a.lodging", "need"]]),
      listed({ settings: { enabled_questions: {}, email_confirmation: false } }),
    );
    expect(off.ok && off.payload.answers).toEqual({});
  });

  it("vlastní otázky: povinná, výběr podle možností, ano/ne, text; vázaná jen pro toho, kdo přijde", () => {
    const model = listed({ questions });
    // Marie nepřijde na hostinu, ale Jan ano: otázka k hostině se týká
    const result = parseSubmission(
      formOf([...everyone, ["a.menu", "ryba"], ["a.tanec", " valčík "], ["a.prekvapeni", "yes"]]),
      model,
    );
    expect(result.ok && result.payload.answers).toEqual({
      menu: "ryba",
      tanec: "valčík",
      prekvapeni: true,
    });

    const missing = parseSubmission(formOf(everyone), model);
    expect(missing).toEqual({ ok: false, errors: { "a.menu": "required" } });
    const wrong = parseSubmission(
      formOf([...everyone, ["a.menu", "svíčková"], ["a.prekvapeni", "ano"]]),
      model,
    );
    expect(wrong).toEqual({ ok: false, errors: { "a.menu": "choice", "a.prekvapeni": "choice" } });

    // nikdo nepřijde na hostinu: otázka k hostině se přeskočí i s odpovědí
    const nobody = parseSubmission(
      formOf([
        [g(G_JAN, E_OBRAD), "yes"],
        [g(G_JAN, E_HOSTINA), "no"],
        [g(G_MARIE, E_OBRAD), "yes"],
        [g(G_MARIE, E_HOSTINA), "no"],
        [g(G_ANEZKA, E_OBRAD), "yes"],
        ["a.menu", "maso"],
        ["a.tanec", "polka"],
      ]),
      model,
    );
    expect(nobody.ok && nobody.payload.answers).toEqual({ menu: "maso" });
  });

  it("e-mail: jen při zapnutém potvrzení, platný tvar, jinak chyba u pole", () => {
    expect(parseSubmission(formOf([...everyone, ["email", "jan@example.test"]]), listed()).ok).toBe(
      true,
    );
    const good = parseSubmission(formOf([...everyone, ["email", " jan@example.test "]]), listed());
    expect(good.ok && good.payload.contact_email).toBe("jan@example.test");
    expect(parseSubmission(formOf([...everyone, ["email", "neni-email"]]), listed())).toEqual({
      ok: false,
      errors: { email: "email" },
    });
    const off = parseSubmission(
      formOf([...everyone, ["email", "jan@example.test"]]),
      listed({ settings: { enabled_questions: {}, email_confirmation: false } }),
    );
    expect(off.ok && off.payload.contact_email).toBeNull();
    const empty = parseSubmission(formOf([...everyone, ["email", ""]]), listed());
    expect(empty.ok && empty.payload.contact_email).toBeNull();
  });
});

describe("host mimo seznam", () => {
  const model = buildUnlistedModel(unlistedView(), "cs");
  const person = (
    n: number,
    kind = "adult",
    extra: [string, string][] = [],
  ): [string, string][] => [
    [`x.${n}.kind`, kind],
    [`x.${n}.name`, `Osoba ${n}`],
    [`x.${n}.ev.${E_OBRAD}`, "yes"],
    [`x.${n}.ev.${E_HOSTINA}`, "no"],
    ...extra,
  ];

  it("vyžaduje aspoň jednu osobu se jménem; nikdo není host ze seznamu", () => {
    expect(parseSubmission(formOf([]), model)).toEqual({
      ok: false,
      errors: { "x.0.name": "name" },
    });
    const result = parseSubmission(
      formOf([...person(0), ...person(1, "child", [["x.1.age", "6"]])]),
      model,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.people.every((p) => p.guest_id === null)).toBe(true);
    expect(result.payload.people[1]).toMatchObject({ is_child: true, age: 6 });
    expect(result.summary.unlisted).toBe(true);
  });

  it("dospělých může být víc, děti jen při zapnutém children", () => {
    const many = parseSubmission(formOf([...person(0), ...person(1), ...person(2)]), model);
    expect(many.ok && many.payload.people).toHaveLength(3);
    const noChildren = buildUnlistedModel(
      unlistedView({ settings: { enabled_questions: {}, email_confirmation: false } }),
      "cs",
    );
    expect(
      parseSubmission(
        formOf([...person(0), ...person(1, "child", [["x.1.age", "6"]])]),
        noChildren,
      ),
    ).toEqual({
      ok: false,
      errors: { "x.1.kind": "invalid" },
    });
  });

  it("stejná čísla osob se nikdy nezdvojí a strop je dvacet osob", () => {
    const entries: [string, string][] = [];
    for (let i = 0; i < 25; i++) entries.push(...person(i));
    const result = parseSubmission(formOf(entries), model);
    expect(result.ok && result.payload.people).toHaveLength(20);
  });
});
