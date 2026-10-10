"use server";

import { guarded } from "@/admin/guard";
import {
  deleteVendor,
  saveNotes,
  saveVendor,
  type NotesResult,
  type VendorActionResult,
} from "@/admin/notes/server";
import type { Guarded } from "@/admin/site/action-types";

/** Server Actions soukromých poznámek a dodavatelů (kontrola původu a relace v `guarded`). */

export async function saveVendorAction(
  id: string | null,
  input: unknown,
): Promise<Guarded<VendorActionResult>> {
  return guarded("uložení dodavatele", (session) => saveVendor(session, id, input));
}

export async function deleteVendorAction(id: string): Promise<Guarded<VendorActionResult>> {
  return guarded("smazání dodavatele", (session) => deleteVendor(session, id));
}

export async function saveNotesAction(input: unknown): Promise<Guarded<NotesResult>> {
  return guarded("uložení poznámek", (session) => saveNotes(session, input));
}
