import { describe, expect, it } from "vitest";
import {
  applyLayout,
  buildLayout,
  capacity,
  firstFreeSeat,
  moveSeat,
  parsePlan,
  pruneAssignments,
  seat,
  seatPoints,
  seatingPresets,
} from "./layout";

const G1 = "g:11111111-1111-4111-8111-111111111111";
const G2 = "g:22222222-2222-4222-8222-222222222222";
const G3 = "g:33333333-3333-4333-8333-333333333333";
const P1 = "p:44444444-4444-4444-8444-444444444444:1";

describe("předvolby rozložení", () => {
  it("kulaté stoly: počet stolů × míst, průměr podle počtu míst", () => {
    const layout = buildLayout("round", { tables: 5, seats: 10 });
    expect(layout.tables).toHaveLength(5);
    expect(capacity(layout.tables)).toBe(50);
    expect(layout.tables[0]).toMatchObject({ id: "t1", label: "Stůl 1", shape: "round", w: 180 });
    expect(buildLayout("round", { seats: 8 }).tables[0].w).toBe(150);
  });

  it("tabule I: místa po obou stranách, čela volitelně", () => {
    expect(capacity(buildLayout("long", { side: 12 }).tables)).toBe(24);
    expect(capacity(buildLayout("long", { side: 12, ends: true }).tables)).toBe(26);
  });

  it("tvar T: čelo jen z jedné strany, noha z obou", () => {
    const layout = buildLayout("t", { head: 6, side: 15 });
    expect(layout.tables.map((t) => [t.id, t.seats])).toEqual([
      ["celo", 6],
      ["noha", 30],
    ]);
  });

  it("tvar U: ramena s vnitřní stranou i bez ní", () => {
    expect(capacity(buildLayout("u", { head: 4, side: 10, inner: true }).tables)).toBe(44);
    expect(capacity(buildLayout("u", { head: 4, side: 10, inner: false }).tables)).toBe(24);
    const layout = buildLayout("u", { head: 4, side: 10 });
    const [head, left, right] = layout.tables;
    expect(left.x).toBeLessThan(head.x);
    expect(right.x).toBeGreaterThan(head.x);
    expect(left.y).toBeGreaterThan(head.y);
  });

  it("hřeben: čelo a zadaný počet ramen", () => {
    const layout = buildLayout("comb", { head: 8, arms: 4, side: 8 });
    expect(layout.tables.map((t) => t.id)).toEqual(["celo", "r1", "r2", "r3", "r4"]);
    expect(capacity(layout.tables)).toBe(8 + 4 * 16);
  });

  it("banket a kombinace s hlavním stolem", () => {
    expect(capacity(buildLayout("banquet", { tables: 4, banquetSeats: 8 }).tables)).toBe(32);
    const mixed = buildLayout("mixed", { head: 6, tables: 3, seats: 8 });
    expect(mixed.tables[0]).toMatchObject({ id: "celo", seats: 6 });
    expect(capacity(mixed.tables)).toBe(30);
  });

  it("neplatné parametry spadnou na výchozí a stoly se nepřekrývají se zápornými souřadnicemi", () => {
    for (const preset of seatingPresets) {
      const layout = buildLayout(preset, { tables: 999 as number, side: -3 as number });
      expect(layout.width).toBeGreaterThan(0);
      for (const table of layout.tables) {
        expect(table.x - table.w / 2).toBeGreaterThan(0);
        expect(table.y - table.h / 2).toBeGreaterThan(0);
        expect(seatPoints(table)).toHaveLength(table.seats);
      }
    }
  });
});

describe("usazení", () => {
  const base = () => applyLayout(parsePlan({}), buildLayout("round", { tables: 2, seats: 4 })).plan;

  it("domácnost najednou na první volná místa; co se nevejde, vrátí", () => {
    let plan = base();
    ({ plan } = seat(plan, [G1, G2], "t1"));
    expect(plan.assignments[G1]).toEqual({ table: "t1", seat: 1 });
    expect(plan.assignments[G2]).toEqual({ table: "t1", seat: 2 });
    const full = seat(plan, [G3, P1, "g:55555555-5555-4555-8555-555555555555"], "t1");
    expect(full.left).toEqual(["g:55555555-5555-4555-8555-555555555555"]);
    expect(firstFreeSeat(full.plan, "t1")).toBeNull();
  });

  it("přesazení uvolní původní místo, null usazení zruší", () => {
    let plan = seat(base(), [G1, G2], "t1").plan;
    plan = seat(plan, [G1], "t2").plan;
    expect(plan.assignments[G1]).toEqual({ table: "t2", seat: 1 });
    expect(firstFreeSeat(plan, "t1")).toBe(1);
    plan = seat(plan, [G1], null).plan;
    expect(plan.assignments[G1]).toBeUndefined();
  });

  it("posun místa prohodí sousedy", () => {
    let plan = seat(base(), [G1, G2], "t1").plan;
    plan = moveSeat(plan, G2, -1);
    expect(plan.assignments[G2].seat).toBe(1);
    expect(plan.assignments[G1].seat).toBe(2);
    expect(moveSeat(plan, G2, -1)).toEqual(plan);
  });

  it("nové rozložení zachová stoly se stejným id a uvolní místa nad kapacitu", () => {
    let plan = seat(base(), [G1, G2, G3], "t1").plan;
    plan = seat(plan, [P1], "t2").plan;
    const { plan: next, released } = applyLayout(
      plan,
      buildLayout("round", { tables: 1, seats: 4 }),
    );
    expect(released).toBe(1);
    expect(Object.keys(next.assignments).sort()).toEqual([G1, G2, G3].sort());
  });

  it("osoby, které už nepřijdou, se z plánu vyřadí; poškozený plán je prázdný", () => {
    const plan = seat(base(), [G1, G2], "t1").plan;
    expect(Object.keys(pruneAssignments(plan, new Set([G2])).assignments)).toEqual([G2]);
    expect(parsePlan({ tables: "nesmysl" }).tables).toEqual([]);
    expect(parsePlan({ assignments: { "x:1": { table: "t1", seat: 1 } } }).tables).toEqual([]);
  });
});
