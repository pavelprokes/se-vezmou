import "server-only";
import { z } from "zod";
import type { AdminSession } from "@/auth/session";
import { tenantRpc } from "@/lib/db/rpc";
import { DbError, type TenantIdentity } from "@/lib/db/transport";
import { INVALID_REASONS } from "./db";
import {
  guestListSchema,
  rsvpOverviewSchema,
  rsvpViewSchema,
  type GuestList,
  type RsvpOverview,
  type RsvpView,
} from "./types";

/**
 * Správcovská strana RSVP (M8 jako server-side vrstva, rozhraní přijde v M7): seznam hostů
 * a domácností, přehled odpovědí (přijde / nepřijde / neodpověděli), ruční zápis hosta, který
 * odpověděl telefonem. Volá se jen s relací správce (`requireSession()` v Server Action nebo
 * stránce); databázové funkce `admin_*` navíc samy vyžadují JWT role admin a filtrují podle svatby.
 * Zdravotní údaje (dieta, alergie) vrací jen `getHouseholdForEntry` pro předvyplnění zápisu.
 */

type AdminIdentity = Pick<AdminSession, "weddingId" | "subjectId">;

function identity(session: AdminIdentity): TenantIdentity {
  return { weddingId: session.weddingId, weddingRole: "admin", subject: session.subjectId };
}

/** Seznam domácností s hosty, pozváními, stavem odpovědi a odpovědi hostů mimo seznam. */
export async function listGuests(session: AdminIdentity): Promise<GuestList> {
  return guestListSchema.parse(await tenantRpc<unknown>(identity(session), "admin_guest_list"));
}

/** Počty po událostech (po hlavách) a po domácnostech. */
export async function getRsvpOverview(session: AdminIdentity): Promise<RsvpOverview> {
  return rsvpOverviewSchema.parse(
    await tenantRpc<unknown>(identity(session), "admin_rsvp_overview"),
  );
}

/** Domácnost a její odpověď pro formulář ručního zápisu; `null`, když domácnost není z této svatby. */
export async function getHouseholdForEntry(
  session: AdminIdentity,
  householdId: string,
): Promise<RsvpView | null> {
  const raw = await tenantRpc<unknown>(identity(session), "admin_rsvp_household", {
    p_household_id: householdId,
  });
  return raw === null ? null : rsvpViewSchema.parse(raw);
}

const uuid = z.uuid();

/** Obsah ručního zápisu; stejný tvar jako odeslání hostem (viz `app.rsvp_apply`). */
export const manualEntrySchema = z.object({
  answers: z.record(z.string().max(63), z.union([z.string().max(1000), z.boolean()])).default({}),
  people: z
    .array(
      z.object({
        guest_id: uuid.nullable(),
        person_name: z.string().min(1).max(200).optional(),
        is_child: z.boolean().optional(),
        age: z.number().int().min(0).max(17).nullable().optional(),
        diet: z.string().max(1000).nullable().optional(),
        allergies: z.string().max(1000).nullable().optional(),
        attendance: z.array(z.object({ event_id: uuid, attending: z.boolean() })),
      }),
    )
    .min(1)
    .max(20),
});
export type ManualEntry = z.input<typeof manualEntrySchema>;

export type ManualEntryResult =
  { ok: true } | { ok: false; reason: "invalid" | "household_not_found" };

/**
 * Ruční zápis odpovědi domácnosti (host odpověděl telefonem). Nezávisí na otevření RSVP, povinné
 * otázky se nevynucují, e-mail se neukládá. Existující odpověď domácnosti se nahradí.
 */
export async function enterResponseManually(
  session: AdminIdentity,
  householdId: string,
  entry: ManualEntry,
): Promise<ManualEntryResult> {
  const parsed = manualEntrySchema.safeParse(entry);
  if (!parsed.success || !uuid.safeParse(householdId).success) {
    return { ok: false, reason: "invalid" };
  }
  try {
    await tenantRpc(identity(session), "admin_rsvp_enter", {
      p_household_id: householdId,
      p_payload: parsed.data,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof DbError) {
      if (error.reason === "household_not_found")
        return { ok: false, reason: "household_not_found" };
      if (error.reason && INVALID_REASONS.has(error.reason))
        return { ok: false, reason: "invalid" };
    }
    throw error;
  }
}
