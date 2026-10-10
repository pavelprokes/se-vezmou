import { z } from "zod";

/**
 * Zasedací pořádek: předvolby rozložení stolů a jejich geometrie (docs/plan-funkci-2026-10.md, fáze 2).
 * Čistý modul bez I/O. Rozměry v centimetrech podle rešerše (příloha plánu): místo na osobu u tabule
 * 65 cm, hloubka stolu 80 cm, kulatý stůl ⌀ 150 cm pro 8 a ⌀ 180 cm pro 10 osob, odstup stolů 150 cm.
 * Plánek je schematický (ne v měřítku sálu), slouží k usazení a k tisku pro obsluhu.
 *
 * Stoly mají stálé identifikátory podle předvolby (`t1`, `t2`, `celo`, `l`, `p`, `r1` …), takže změna
 * rozměrů zachová usazení u stolů, které zůstaly; místa nad novou kapacitu se uvolní.
 */

export const SEAT_PITCH = 65;
export const TABLE_DEPTH = 80;
export const GAP = 150;
const CHAIR = 45;

export const seatingPresets = ["round", "long", "t", "u", "comb", "banquet", "mixed"] as const;
export type SeatingPreset = (typeof seatingPresets)[number];

const int = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).catch(fallback);

/** Parametry předvoleb; neplatná hodnota spadne na výchozí (formulář nikdy nerozbije plán). */
export const presetParamsSchema = z.object({
  /** Počet kulatých / banketních stolů. */
  tables: int(1, 60, 6),
  /** Míst u kulatého stolu. */
  seats: int(4, 12, 8),
  /** Míst u banketního stolu (180 × 80, obě strany). */
  banquetSeats: int(4, 8, 6),
  /** Hlavní stůl (čelo): míst jen na jedné straně, s výhledem do sálu. */
  head: int(2, 20, 6),
  /** Míst na jedné straně tabule I, nohy T nebo ramene U a hřebene. */
  side: int(2, 40, 10),
  /** Počet ramen hřebene. */
  arms: int(2, 5, 3),
  /** Tvar U: sedí se i na vnitřní straně ramen. */
  inner: z.boolean().catch(true),
  /** Tabule I: místa i na čelech (po jednom). */
  ends: z.boolean().catch(false),
});
export type PresetParams = z.infer<typeof presetParamsSchema>;

export const DEFAULT_PARAMS: PresetParams = presetParamsSchema.parse({});

/** Kolik míst je na které straně obdélníkového stolu (horní strana je ta k sálu, u čela jediná). */
export interface Sides {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface SeatTable {
  id: string;
  /** Název pro tisk a čtečku: „Stůl 3“, „Hlavní stůl“, „Levé rameno“. */
  label: string;
  shape: "round" | "rect";
  /** Střed stolu v cm. */
  x: number;
  y: number;
  /** Rozměry desky v cm (u kulatého průměr v `w`). */
  w: number;
  h: number;
  /** Kulatý: počet míst. Obdélníkový: místa po stranách. */
  seats: number;
  sides?: Sides;
}

export interface SeatingLayout {
  preset: SeatingPreset;
  params: PresetParams;
  tables: SeatTable[];
  /** Ohraničení plánku v cm (včetně židlí a okraje). */
  width: number;
  height: number;
}

export type TableLabels = {
  table: (n: number) => string;
  head: string;
  long: string;
  leg: string;
  left: string;
  right: string;
  arm: (n: number) => string;
};

export const CZ_LABELS: TableLabels = {
  table: (n) => `Stůl ${n}`,
  head: "Hlavní stůl",
  long: "Tabule",
  leg: "Dlouhý stůl",
  left: "Levé rameno",
  right: "Pravé rameno",
  arm: (n) => `Rameno ${n}`,
};

function diameterFor(seats: number): number {
  return seats <= 6 ? 120 : seats <= 8 ? 150 : seats <= 10 ? 180 : 200;
}

function rect(
  id: string,
  label: string,
  x: number,
  y: number,
  sides: Sides,
  vertical = false,
): SeatTable {
  const along = Math.max(sides.top, sides.bottom, sides.left, sides.right, 1);
  const length = Math.max(along * SEAT_PITCH + 20, 120);
  const seats = sides.top + sides.bottom + sides.left + sides.right;
  return {
    id,
    label,
    shape: "rect",
    x,
    y,
    w: vertical ? TABLE_DEPTH : length,
    h: vertical ? length : TABLE_DEPTH,
    seats,
    sides,
  };
}

function grid(count: number, cell: number) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * 1.4)));
  return Array.from({ length: count }, (_, i) => ({
    x: (i % cols) * cell + cell / 2,
    y: Math.floor(i / cols) * cell + cell / 2,
  }));
}

/** Rozložení podle předvolby; souřadnice začínají v levém horním rohu plánku (okraj 1 m). */
export function buildLayout(
  preset: SeatingPreset,
  input: Partial<PresetParams>,
  labels: TableLabels = CZ_LABELS,
): SeatingLayout {
  const params = presetParamsSchema.parse({ ...DEFAULT_PARAMS, ...input });
  const tables: SeatTable[] = [];
  const pitch = SEAT_PITCH;
  const side = params.side;

  switch (preset) {
    case "round":
    case "mixed": {
      const offset = preset === "mixed" ? TABLE_DEPTH + CHAIR * 2 + GAP : 0;
      if (preset === "mixed") {
        const head = rect("celo", labels.head, 0, 0, {
          top: params.head,
          bottom: 0,
          left: 0,
          right: 0,
        });
        tables.push(head);
      }
      const d = diameterFor(params.seats);
      const cell = d + CHAIR * 2 + GAP;
      grid(params.tables, cell).forEach((p, i) =>
        tables.push({
          id: `t${i + 1}`,
          label: labels.table(i + 1),
          shape: "round",
          x: p.x,
          y: p.y + offset,
          w: d,
          h: d,
          seats: params.seats,
        }),
      );
      if (preset === "mixed") {
        // čelo vycentrovat nad kulaté stoly
        const xs = tables.filter((t) => t.shape === "round").map((t) => t.x);
        tables[0].x = (Math.min(...xs) + Math.max(...xs)) / 2;
        tables[0].y = TABLE_DEPTH / 2;
      }
      break;
    }
    case "banquet": {
      const perSide = Math.ceil(params.banquetSeats / 2);
      const cellX = 180 + GAP;
      const cellY = TABLE_DEPTH + CHAIR * 2 + GAP;
      const cols = Math.max(1, Math.ceil(Math.sqrt(params.tables)));
      for (let i = 0; i < params.tables; i++) {
        const table = rect(`t${i + 1}`, labels.table(i + 1), 0, 0, {
          top: perSide,
          bottom: params.banquetSeats - perSide,
          left: 0,
          right: 0,
        });
        table.w = Math.max(table.w, 180);
        table.x = (i % cols) * cellX + cellX / 2;
        table.y = Math.floor(i / cols) * cellY + cellY / 2;
        tables.push(table);
      }
      break;
    }
    case "long": {
      tables.push(
        rect("tabule", labels.long, 0, 0, {
          top: side,
          bottom: side,
          left: params.ends ? 1 : 0,
          right: params.ends ? 1 : 0,
        }),
      );
      break;
    }
    case "t": {
      const head = rect("celo", labels.head, 0, 0, {
        top: params.head,
        bottom: 0,
        left: 0,
        right: 0,
      });
      const leg = rect(
        "noha",
        labels.leg,
        0,
        0,
        { top: 0, bottom: 0, left: side, right: side },
        true,
      );
      head.w = Math.max(head.w, leg.w + CHAIR * 4 + 2 * pitch);
      leg.y = head.h / 2 + leg.h / 2;
      tables.push(head, leg);
      break;
    }
    case "u": {
      const inner = params.inner ? side : 0;
      const left = rect(
        "l",
        labels.left,
        0,
        0,
        { top: 0, bottom: 0, left: side, right: inner },
        true,
      );
      const right = rect(
        "p",
        labels.right,
        0,
        0,
        { top: 0, bottom: 0, left: inner, right: side },
        true,
      );
      // vnitřek U: dvě řady židlí a ulička pro obsluhu
      const opening = (params.inner ? CHAIR * 2 : 0) + 150;
      const head = rect("celo", labels.head, 0, 0, {
        top: params.head,
        bottom: 0,
        left: 0,
        right: 0,
      });
      head.w = Math.max(head.w, TABLE_DEPTH * 2 + opening);
      left.x = -head.w / 2 + TABLE_DEPTH / 2;
      right.x = head.w / 2 - TABLE_DEPTH / 2;
      left.y = right.y = head.h / 2 + left.h / 2;
      tables.push(head, left, right);
      break;
    }
    case "comb": {
      const head = rect("celo", labels.head, 0, 0, {
        top: params.head,
        bottom: 0,
        left: 0,
        right: 0,
      });
      const armSpacing = TABLE_DEPTH + CHAIR * 4 + 90;
      head.w = Math.max(head.w, params.arms * armSpacing);
      tables.push(head);
      for (let i = 0; i < params.arms; i++) {
        const arm = rect(
          `r${i + 1}`,
          labels.arm(i + 1),
          0,
          0,
          { top: 0, bottom: 0, left: side, right: side },
          true,
        );
        arm.x =
          -head.w / 2 + armSpacing / 2 + (i * (head.w - armSpacing)) / Math.max(params.arms - 1, 1);
        if (params.arms === 1) arm.x = 0;
        arm.y = head.h / 2 + arm.h / 2;
        tables.push(arm);
      }
      break;
    }
  }

  return normalize({ preset, params, tables, width: 0, height: 0 });
}

/** Posune stoly tak, aby plánek začínal v (okraj, okraj), a spočítá jeho rozměr. */
function normalize(layout: SeatingLayout): SeatingLayout {
  const margin = 100;
  const pad = CHAIR + 20;
  const minX = Math.min(...layout.tables.map((t) => t.x - t.w / 2 - pad));
  const minY = Math.min(...layout.tables.map((t) => t.y - t.h / 2 - pad));
  const maxX = Math.max(...layout.tables.map((t) => t.x + t.w / 2 + pad));
  const maxY = Math.max(...layout.tables.map((t) => t.y + t.h / 2 + pad));
  const tables = layout.tables.map((t) => ({
    ...t,
    x: Math.round(t.x - minX + margin),
    y: Math.round(t.y - minY + margin),
  }));
  return {
    ...layout,
    tables,
    width: Math.round(maxX - minX + margin * 2),
    height: Math.round(maxY - minY + margin * 2),
  };
}

export function capacity(tables: readonly SeatTable[]): number {
  return tables.reduce((sum, t) => sum + t.seats, 0);
}

/** Středy židlí kolem stolu (pro kreslení), v pořadí čísel míst 1…n. */
export function seatPoints(table: SeatTable): { x: number; y: number }[] {
  if (table.shape === "round") {
    const r = table.w / 2 + CHAIR / 2 + 4;
    return Array.from({ length: table.seats }, (_, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / table.seats;
      return { x: table.x + r * Math.cos(angle), y: table.y + r * Math.sin(angle) };
    });
  }
  const sides = table.sides ?? { top: 0, bottom: table.seats, left: 0, right: 0 };
  const points: { x: number; y: number }[] = [];
  const along = (count: number, length: number) =>
    Array.from({ length: count }, (_, i) => -length / 2 + (length * (i + 0.5)) / count);
  const off = CHAIR / 2 + 4;
  for (const dx of along(sides.top, table.w))
    points.push({ x: table.x + dx, y: table.y - table.h / 2 - off });
  for (const dy of along(sides.right, table.h))
    points.push({ x: table.x + table.w / 2 + off, y: table.y + dy });
  for (const dx of along(sides.bottom, table.w))
    points.push({ x: table.x + dx, y: table.y + table.h / 2 + off });
  for (const dy of along(sides.left, table.h))
    points.push({ x: table.x - table.w / 2 - off, y: table.y + dy });
  return points;
}

// --- uložený plán ----------------------------------------------------------------------------

const sidesSchema = z.object({
  top: z.number().int().min(0).max(60),
  bottom: z.number().int().min(0).max(60),
  left: z.number().int().min(0).max(60),
  right: z.number().int().min(0).max(60),
});

export const seatTableSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,20}$/),
  label: z.string().min(1).max(60),
  shape: z.enum(["round", "rect"]),
  x: z.number().min(0).max(100000),
  y: z.number().min(0).max(100000),
  w: z.number().min(10).max(10000),
  h: z.number().min(10).max(10000),
  seats: z.number().int().min(0).max(240),
  sides: sidesSchema.optional(),
});

/** Klíč osoby: `g:<id hosta>` nebo `p:<id odpovědi>:<pořadí>` (viz `admin_seating_get`). */
export const PERSON_KEY = /^(g:[0-9a-f-]{36}|p:[0-9a-f-]{36}:\d{1,2})$/;

export const assignmentSchema = z.object({
  table: z.string().regex(/^[a-z0-9-]{1,20}$/),
  seat: z.number().int().min(1).max(240),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const seatingPlanSchema = z.object({
  version: z.literal(1).default(1),
  preset: z.enum(seatingPresets).default("round"),
  params: presetParamsSchema.default(DEFAULT_PARAMS),
  /** Událost, na kterou se usazuje (hostina); `null` = kdokoli, kdo na něco přijde. */
  eventId: z.string().nullable().default(null),
  tables: z.array(seatTableSchema).max(200).default([]),
  width: z.number().min(0).max(100000).default(0),
  height: z.number().min(0).max(100000).default(0),
  assignments: z.record(z.string().regex(PERSON_KEY), assignmentSchema).default({}),
});
export type SeatingPlan = z.infer<typeof seatingPlanSchema>;

/** Plán z databáze; poškozený nebo prázdný dokument je prázdný plán (bez stolů). */
export function parsePlan(raw: unknown): SeatingPlan {
  const parsed = seatingPlanSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : seatingPlanSchema.parse({});
}

/**
 * Nové rozložení: usazení zůstane u stolů se stejným identifikátorem, pokud se místo vejde; ostatní
 * osoby se uvolní (vrací i jejich počet, aby rozhraní mohlo varovat).
 */
export function applyLayout(
  plan: SeatingPlan,
  layout: SeatingLayout,
): { plan: SeatingPlan; released: number } {
  const byId = new Map(layout.tables.map((t) => [t.id, t]));
  const assignments: SeatingPlan["assignments"] = {};
  let released = 0;
  for (const [key, a] of Object.entries(plan.assignments)) {
    const table = byId.get(a.table);
    if (table && a.seat <= table.seats) assignments[key] = a;
    else released += 1;
  }
  return {
    plan: {
      ...plan,
      preset: layout.preset,
      params: layout.params,
      tables: layout.tables,
      width: layout.width,
      height: layout.height,
      assignments,
    },
    released,
  };
}

/** Obsazená místa stolu: číslo místa -> klíč osoby. */
export function occupancy(plan: SeatingPlan, tableId: string): Map<number, string> {
  const seats = new Map<number, string>();
  for (const [key, a] of Object.entries(plan.assignments)) {
    if (a.table === tableId) seats.set(a.seat, key);
  }
  return seats;
}

/** První volné místo u stolu, nebo `null`, když je plný. */
export function firstFreeSeat(plan: SeatingPlan, tableId: string): number | null {
  const table = plan.tables.find((t) => t.id === tableId);
  if (!table) return null;
  const taken = occupancy(plan, tableId);
  for (let seat = 1; seat <= table.seats; seat++) if (!taken.has(seat)) return seat;
  return null;
}

/**
 * Usadí osoby ke stolu na první volná místa (domácnost najednou, vedle sebe). `null` stůl = uvolnit.
 * Osoby, pro které místo nezbylo, vrací v `left` (rozhraní řekne, že se nevešly).
 */
export function seat(
  plan: SeatingPlan,
  keys: readonly string[],
  tableId: string | null,
): { plan: SeatingPlan; left: string[] } {
  const assignments = { ...plan.assignments };
  for (const key of keys) delete assignments[key];
  let next: SeatingPlan = { ...plan, assignments };
  if (tableId === null) return { plan: next, left: [] };
  const left: string[] = [];
  for (const key of keys) {
    const free = firstFreeSeat(next, tableId);
    if (free === null) {
      left.push(key);
      continue;
    }
    next = { ...next, assignments: { ...next.assignments, [key]: { table: tableId, seat: free } } };
  }
  return { plan: next, left };
}

/** Prohodí osobu s místem o jedno vedle (pořadí u stolu); prázdné místo se jen obsadí. */
export function moveSeat(plan: SeatingPlan, key: string, delta: -1 | 1): SeatingPlan {
  const current = plan.assignments[key];
  if (!current) return plan;
  const table = plan.tables.find((t) => t.id === current.table);
  if (!table) return plan;
  const target = current.seat + delta;
  if (target < 1 || target > table.seats) return plan;
  const other = [...occupancy(plan, table.id)].find(([s]) => s === target)?.[1];
  const assignments = { ...plan.assignments, [key]: { table: table.id, seat: target } };
  if (other) assignments[other] = { table: table.id, seat: current.seat };
  return { ...plan, assignments };
}

/** Odebere usazení osob, které v seznamu potvrzených už nejsou (změnily odpověď). */
export function pruneAssignments(plan: SeatingPlan, keys: ReadonlySet<string>): SeatingPlan {
  const assignments = Object.fromEntries(
    Object.entries(plan.assignments).filter(([key]) => keys.has(key)),
  );
  return { ...plan, assignments };
}
