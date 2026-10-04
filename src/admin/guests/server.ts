import "server-only";
import { limited, reasonOf } from "@/lib/rate-guard";
import { randomUUID } from "node:crypto";
import { RATE_RULES } from "@/auth/config";
import {
  adminGuestsImport,
  adminHouseholdDelete,
  adminHouseholdSave,
  adminInvitationsBulk,
  adminInvitationsBulkTag,
  adminRsvpNotifyGet,
  adminRsvpNotifySet,
  adminRsvpSettingsGet,
  adminRsvpSettingsSave,
  type AdminIdentity,
} from "@/lib/db/admin-guests";
import { listGuests } from "@/lib/rsvp/admin";
import type { GuestList } from "@/lib/rsvp/types";
import { z } from "zod";
import { readTable, type FileFailure } from "./import-file";
import {
  checkRows,
  interpretTable,
  preview,
  toHouseholds,
  totals,
  type ImportRow,
  type PreviewRow,
  type PreviewTotals,
  type TableFailure,
} from "./import-parse";
import {
  householdInputSchema,
  householdToPayload,
  rsvpSettingsInputSchema,
  rsvpSettingsViewSchema,
  settingsToPayload,
  tagSchema,
  type RsvpSettingsView,
} from "./types";

/**
 * Serverová logika správy hostů a nastavení RSVP (M7b) bez závislosti na Next.js: omezení počtu
 * požadavků, ověření vstupu a volání databázových funkcí. Svatba je vždy ta z relace
 * (`AdminIdentity`). Do logu se nedostanou jména ani jiné osobní údaje (chyby jen názvem).
 */

export type { AdminIdentity };

export type Limited = { status: "limited"; retryAfter: number };

// --- seznam ---------------------------------------------------------------------------------

export function loadGuests(session: AdminIdentity): Promise<GuestList> {
  return listGuests(session);
}

// --- domácnost ------------------------------------------------------------------------------

export type SaveHouseholdResult =
  | { status: "saved"; householdId: string }
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "guest_limit" }
  | Limited;

export async function saveHousehold(
  session: AdminIdentity,
  householdId: string | null,
  input: unknown,
): Promise<SaveHouseholdResult> {
  const parsed = householdInputSchema.safeParse(input);
  if (!parsed.success || (householdId !== null && !z.uuid().safeParse(householdId).success)) {
    return { status: "invalid" };
  }
  const retry = await limited("guests-write", session.weddingId, RATE_RULES.guestsWriteWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    const id = await adminHouseholdSave(session, householdId, householdToPayload(parsed.data));
    return { status: "saved", householdId: id };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "household_not_found") return { status: "not_found" };
    if (reason === "guest_limit_exceeded") return { status: "guest_limit" };
    if (reason === "invalid_payload" || reason === "invalid_guest" || reason === "invalid_event") {
      return { status: "invalid" };
    }
    throw error;
  }
}

export type DeleteHouseholdResult = { status: "deleted" } | { status: "not_found" } | Limited;

export async function deleteHousehold(
  session: AdminIdentity,
  householdId: unknown,
): Promise<DeleteHouseholdResult> {
  const id = z.uuid().safeParse(householdId);
  if (!id.success) return { status: "not_found" };
  const retry = await limited("guests-write", session.weddingId, RATE_RULES.guestsWriteWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    await adminHouseholdDelete(session, id.data);
    return { status: "deleted" };
  } catch (error) {
    if (reasonOf(error) === "household_not_found") return { status: "not_found" };
    throw error;
  }
}

export type BulkInviteResult = { status: "ok"; rows: number } | { status: "invalid" } | Limited;

/** Pozvání na událost (nebo jeho zrušení) všem hostům, nebo jen domácnostem se skupinou `tag`. */
export async function bulkInvite(
  session: AdminIdentity,
  eventId: unknown,
  invited: unknown,
  tag: unknown = null,
): Promise<BulkInviteResult> {
  const event = z.uuid().safeParse(eventId);
  const group = tagSchema.nullable().safeParse(tag);
  if (!event.success || typeof invited !== "boolean" || !group.success) {
    return { status: "invalid" };
  }
  const retry = await limited("guests-write", session.weddingId, RATE_RULES.guestsWriteWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    return {
      status: "ok",
      // bez skupiny původní funkce: funguje i v okamžiku nasazení před doběhnutím migrace
      rows:
        group.data === null
          ? await adminInvitationsBulk(session, event.data, invited)
          : await adminInvitationsBulkTag(session, event.data, invited, group.data),
    };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "invalid_event" || reason === "invalid_payload") return { status: "invalid" };
    throw error;
  }
}

// --- import ---------------------------------------------------------------------------------

export type ImportPreviewResult =
  | { status: "ok"; rows: PreviewRow[]; totals: PreviewTotals }
  | { status: "failed"; reason: FileFailure | TableFailure }
  | Limited;

/** Náhled importu: soubor se přečte a ověří, nic se nezapisuje. */
export async function previewImport(
  session: AdminIdentity,
  bytes: Uint8Array,
): Promise<ImportPreviewResult> {
  const retry = await limited("guests-import", session.weddingId, RATE_RULES.guestsImportWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };

  const file = await readTable(bytes);
  if (!file.ok) return { status: "failed", reason: file.reason };
  const parsed = interpretTable(file.table);
  if (!parsed.ok) return { status: "failed", reason: parsed.reason };

  const existing = await listGuests(session);
  const names = existing.households.flatMap((h) => h.guests.map((g) => g.display_name));
  const rows = preview(parsed, names);
  return { status: "ok", rows, totals: totals(rows, false) };
}

const savedQuestionsSchema = z.array(z.object({ key: z.string(), id: z.string() }));

const importRowSchema = z.object({
  line: z.number().int().min(1).max(100000),
  household: z.string().max(1000),
  name: z.string().max(1000),
  isChild: z.boolean(),
  age: z.number().int().min(0).max(120).nullable(),
});

const commitSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(1000),
  includeDuplicates: z.boolean(),
  eventIds: z.array(z.uuid()).max(50),
  /** Idempotenční klíč dávky (UUID z prohlížeče, platný pro jeden náhled); opakování vrátí výsledek první dávky. */
  nonce: z.guid().optional(),
});

export type CommitImportResult =
  | { status: "imported"; households: number; guests: number; skipped: number; duplicate: boolean }
  | { status: "invalid" }
  | { status: "nothing" }
  | { status: "guest_limit" }
  | Limited;

/**
 * Zápis po potvrzení náhledu. Řádky přicházejí z prohlížeče, proto se ověří znovu stejnými
 * pravidly jako v náhledu. Duplicity s existujícími hosty (a mezi řádky souboru) vyřazuje databáze pod
 * zámkem svatby v okamžiku zápisu, ne aplikace z dřívějšího čtení seznamu; opakované odeslání téhož
 * náhledu (stejný `nonce`) nic nezapíše podruhé a vrátí výsledek první dávky.
 */
export async function commitImport(
  session: AdminIdentity,
  input: unknown,
): Promise<CommitImportResult> {
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const retry = await limited("guests-import", session.weddingId, RATE_RULES.guestsImportWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };

  const rows: ImportRow[] = parsed.data.rows.map((row) => ({
    ...row,
    household: row.household.replace(/\s+/g, " ").trim(),
    name: row.name.replace(/\s+/g, " ").trim(),
    age: row.isChild ? row.age : null,
  }));
  const checked = preview({ ok: true, rows, problems: checkRows(rows) }, []);
  // všechny platné řádky; které jsou duplicitní, rozhoduje databáze (include_duplicates)
  const households = toHouseholds(checked, true);
  if (households.length === 0) return { status: "nothing" };

  try {
    const result = await adminGuestsImport(session, {
      nonce: parsed.data.nonce ?? randomUUID(),
      include_duplicates: parsed.data.includeDuplicates,
      households,
      invited_event_ids: parsed.data.eventIds,
    });
    if (result.guests === 0) return { status: "nothing" };
    return {
      status: "imported",
      households: result.households,
      guests: result.guests,
      skipped: result.skipped,
      duplicate: result.duplicate,
    };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "guest_limit_exceeded") return { status: "guest_limit" };
    if (reason === "invalid_payload" || reason === "invalid_event") return { status: "invalid" };
    throw error;
  }
}

// --- nastavení RSVP -------------------------------------------------------------------------

export async function loadRsvpSettings(session: AdminIdentity): Promise<RsvpSettingsView> {
  const [view, notifyCouple] = await Promise.all([
    adminRsvpSettingsGet(session),
    adminRsvpNotifyGet(session),
  ]);
  const parsed = rsvpSettingsViewSchema.parse(view);
  return { ...parsed, settings: { ...parsed.settings, notify_couple: notifyCouple } };
}

export type SaveSettingsResult =
  | { status: "saved"; questions: { key: string; id: string }[] }
  | { status: "invalid"; reason?: "period" | "question" | "event" }
  | Limited;

export async function saveRsvpSettings(
  session: AdminIdentity,
  input: unknown,
): Promise<SaveSettingsResult> {
  const parsed = rsvpSettingsInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const { opensAt, closesAt } = parsed.data;
  if (opensAt && closesAt && Date.parse(closesAt) <= Date.parse(opensAt)) {
    return { status: "invalid", reason: "period" };
  }
  const retry = await limited("guests-write", session.weddingId, RATE_RULES.guestsWriteWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    const ids = savedQuestionsSchema.parse(
      await adminRsvpSettingsSave(session, settingsToPayload(parsed.data)),
    );
    await adminRsvpNotifySet(session, parsed.data.notifyCouple);
    return { status: "saved", questions: ids };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "invalid_period") return { status: "invalid", reason: "period" };
    if (reason === "invalid_question") return { status: "invalid", reason: "question" };
    if (reason === "invalid_event") return { status: "invalid", reason: "event" };
    if (reason === "invalid_payload") return { status: "invalid" };
    throw error;
  }
}
