"use server";

import { guarded } from "@/admin/guard";
import {
  bulkInvite,
  commitImport,
  deleteHousehold,
  resetInvite,
  saveHousehold,
  type BulkInviteResult,
  type CommitImportResult,
  type DeleteHouseholdResult,
  type ResetInviteResult,
  type SaveHouseholdResult,
} from "@/admin/guests/server";
import type { Guarded } from "@/admin/site/action-types";
import { loadSeating, saveSeating, type SaveSeatingResult } from "@/admin/seating/server";

/**
 * Server Actions seznamu hostů (M7b). Každá začíná kontrolou původu a ověřením relace (`guarded`),
 * vstup se znovu ověřuje na serveru a svatba je vždy ta z relace. Jména hostů se nelogují.
 */

export async function saveHouseholdAction(
  householdId: string | null,
  input: unknown,
): Promise<Guarded<SaveHouseholdResult>> {
  return guarded("uložení domácnosti", (session) => saveHousehold(session, householdId, input));
}

export async function deleteHouseholdAction(
  householdId: string,
): Promise<Guarded<DeleteHouseholdResult>> {
  return guarded("smazání domácnosti", (session) => deleteHousehold(session, householdId));
}

export async function resetInviteAction(householdId: string): Promise<Guarded<ResetInviteResult>> {
  return guarded("výměna osobního odkazu", (session) => resetInvite(session, householdId));
}

export async function bulkInviteAction(
  eventId: string,
  invited: boolean,
  tag: string | null,
): Promise<Guarded<BulkInviteResult>> {
  return guarded("hromadné pozvání", (session) => bulkInvite(session, eventId, invited, tag));
}

export async function commitImportAction(input: unknown): Promise<Guarded<CommitImportResult>> {
  return guarded("import hostů", (session) => commitImport(session, input));
}

/** Zasedací pořádek: celý plán s verzí; usazení osob, které už nepřijdou, se vyřadí. */
export async function saveSeatingAction(input: unknown): Promise<Guarded<SaveSeatingResult>> {
  return guarded("uložení zasedacího pořádku", async (session) => {
    const data = await loadSeating(session);
    const keys = new Set(data.people.map((person) => person.key));
    return saveSeating(session, input, keys);
  });
}
