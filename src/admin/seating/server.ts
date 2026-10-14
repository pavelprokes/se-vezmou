import "server-only";
import { z } from "zod";
import type { AdminSession } from "@/auth/session";
import { RATE_RULES } from "@/auth/config";
import { tenantRpc, READ_ONLY } from "@/lib/db/rpc";
import { DbError, type TenantIdentity } from "@/lib/db/transport";
import { limited } from "@/lib/rate-guard";
import { i18nTextSchema } from "@/site/i18n-text";
import { parsePlan, pruneAssignments, seatingPlanSchema, type SeatingPlan } from "./layout";

/**
 * Zasedací pořádek na serveru: načtení plánu s osobami, které potvrdily účast, a uložení celého plánu
 * s kontrolou verze (dva správci najednou). Jména osob se do plánu neukládají, jen klíče.
 */

type AdminIdentity = Pick<AdminSession, "weddingId" | "subjectId">;

function identity(session: AdminIdentity): TenantIdentity {
  return { weddingId: session.weddingId, weddingRole: "admin", subject: session.subjectId };
}

const seatingViewSchema = z.object({
  plan: z.unknown(),
  rev: z.number().int(),
  events: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["ceremony", "reception", "other"]),
      title: i18nTextSchema,
    }),
  ),
  people: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      household_id: z.string().nullable(),
      household: z.string().nullable(),
      is_child: z.boolean(),
      age: z.number().nullable(),
      is_plus_one: z.boolean(),
      attending: z.array(z.string()),
    }),
  ),
});

export interface SeatingPerson {
  key: string;
  name: string;
  /** Skupina pro „posadit celou domácnost“: domácnost, u hosta mimo seznam jeho odpověď. */
  group: string;
  groupLabel: string;
  isChild: boolean;
  age: number | null;
  isPlusOne: boolean;
  attending: string[];
}

export interface SeatingData {
  plan: SeatingPlan;
  rev: number;
  events: z.infer<typeof seatingViewSchema>["events"];
  people: SeatingPerson[];
}

export async function loadSeating(session: AdminIdentity): Promise<SeatingData> {
  const raw = seatingViewSchema.parse(
    await tenantRpc<unknown>(identity(session), "admin_seating_get", {}, "scalar", READ_ONLY),
  );
  const people: SeatingPerson[] = raw.people.map((p) => {
    const response = p.key.startsWith("p:") ? p.key.split(":")[1] : null;
    return {
      key: p.key,
      name: p.name,
      group: p.household_id ?? response ?? p.key,
      groupLabel: p.household?.trim() || p.name,
      isChild: p.is_child,
      age: p.age,
      isPlusOne: p.is_plus_one,
      attending: p.attending,
    };
  });
  const plan = parsePlan(raw.plan);
  // Výchozí událost: hostina, je-li; jinak kdokoli, kdo na něco přijde.
  const eventId =
    plan.eventId && raw.events.some((e) => e.id === plan.eventId)
      ? plan.eventId
      : (raw.events.find((e) => e.kind === "reception")?.id ?? null);
  return { plan: { ...plan, eventId }, rev: raw.rev, events: raw.events, people };
}

/** Osoby, které se usazují: potvrdily účast na zvolené události (bez události na kterékoli). */
export function seatedPeople(data: Pick<SeatingData, "people">, eventId: string | null) {
  return data.people.filter((p) =>
    eventId === null ? p.attending.length > 0 : p.attending.includes(eventId),
  );
}

export type SaveSeatingResult =
  | { status: "saved"; rev: number }
  | { status: "conflict" }
  | { status: "invalid" }
  | { status: "limited"; retryAfter: number };

const saveInputSchema = z.object({ plan: seatingPlanSchema, rev: z.number().int().min(0) });

export async function saveSeating(
  session: AdminIdentity,
  input: unknown,
  /** Klíče osob, které teď potvrdily účast (usazení ostatních se při uložení vyřadí). */
  validKeys?: ReadonlySet<string>,
): Promise<SaveSeatingResult> {
  const parsed = saveInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const retry = await limited("seating-save", session.weddingId, RATE_RULES.guestsWriteWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  const plan = validKeys ? pruneAssignments(parsed.data.plan, validKeys) : parsed.data.plan;
  // Usazení jen k existujícím stolům a na místo v kapacitě stolu
  const tables = new Map(plan.tables.map((t) => [t.id, t]));
  const clean = Object.fromEntries(
    Object.entries(plan.assignments).filter(([, a]) => {
      const table = tables.get(a.table);
      return table !== undefined && a.seat <= table.seats;
    }),
  );
  try {
    const rev = await tenantRpc<number>(identity(session), "admin_seating_save", {
      p_plan: { ...plan, assignments: clean },
      p_rev: parsed.data.rev,
    });
    return { status: "saved", rev };
  } catch (error) {
    if (error instanceof DbError && error.reason === "conflict") return { status: "conflict" };
    if (error instanceof DbError && error.reason === "invalid_payload")
      return { status: "invalid" };
    throw error;
  }
}
