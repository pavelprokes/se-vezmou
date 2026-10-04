"use server";

import { guarded } from "@/admin/guard";
import {
  bulkInvite,
  commitImport,
  deleteHousehold,
  saveHousehold,
  type BulkInviteResult,
  type CommitImportResult,
  type DeleteHouseholdResult,
  type SaveHouseholdResult,
} from "@/admin/guests/server";
import type { Guarded } from "@/admin/site/action-types";

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
