"use server";

import { guarded } from "@/admin/guard";
import { saveRsvpSettings, type SaveSettingsResult } from "@/admin/guests/server";
import { sendGuestUpdates, type GuestUpdateResult } from "@/admin/guests/updates";
import type { Guarded } from "@/admin/site/action-types";
import { getUiLocale } from "@/auth/request";
import type { EntryState } from "@/components/admin/guests/response-entry";
import { enterResponseManually, getHouseholdForEntry } from "@/lib/rsvp/admin";
import { buildListedModel } from "@/lib/rsvp/form";
import { parseSubmission } from "@/lib/rsvp/submission";

/**
 * Server Actions přehledu odpovědí a nastavení RSVP (M7b). Ruční zápis odpovědi sestaví model
 * formuláře znovu z databáze (hosté domácnosti, jejich pozvání, zapnuté otázky): z formuláře se
 * berou jen odpovědi, nikdy identifikátory hostů ani událostí mimo model, a databáze obsah ještě
 * jednou ověří. Povinné vlastní otázky se od správce nevyžadují (telefonát nemusí odpovědět na všechno).
 */

export async function saveSettingsAction(input: unknown): Promise<Guarded<SaveSettingsResult>> {
  return guarded("uložení nastavení RSVP", (session) => saveRsvpSettings(session, input));
}

/** Upozornění hostům na změnu: e-mail všem, kdo se v odpovědi přihlásili (omezeno počtem za den). */
export async function sendGuestUpdatesAction(input: unknown): Promise<Guarded<GuestUpdateResult>> {
  return guarded("upozornění hostům na změnu", (session) => sendGuestUpdates(session, input));
}

export async function enterResponseAction(
  householdId: string,
  formData: FormData,
): Promise<EntryState> {
  const result = await guarded("ruční zápis odpovědi", async (session): Promise<EntryState> => {
    const view = await getHouseholdForEntry(session, householdId);
    if (!view) return { status: "failed" };
    const model = buildListedModel(view, await getUiLocale());
    // Souhlas s upozorněním na změny dává jen host sám, ruční zápis ho nenabízí.
    const relaxed = {
      ...model,
      flags: { ...model.flags, updates: false },
      questions: model.questions.map((question) => ({ ...question, required: false })),
    };
    const parsed = parseSubmission(formData, relaxed);
    if (!parsed.ok) return { status: "errors", errors: parsed.errors };
    const outcome = await enterResponseManually(session, householdId, {
      answers: parsed.payload.answers,
      people: parsed.payload.people,
    });
    return outcome.ok ? { status: "saved" } : { status: "failed" };
  });
  return result !== null &&
    "status" in result &&
    (result.status === "saved" || result.status === "errors")
    ? result
    : { status: "failed" };
}
