import type { Guarded } from "@/admin/site/action-types";
import type {
  BulkInviteResult,
  CommitImportResult,
  DeleteHouseholdResult,
  ResetInviteResult,
  SaveHouseholdResult,
  SaveSettingsResult,
} from "./server";

/**
 * Tvary Server Actions správy hostů (M7b): prostá serializovatelná data, nikdy výjimka a nikdy
 * osobní údaje. `Guarded` přidává stavy `error` (neočekávaná chyba) a `unauthorized` (relace vypršela).
 */

export type { Guarded };

export type SaveHouseholdAction = (
  householdId: string | null,
  input: unknown,
) => Promise<Guarded<SaveHouseholdResult>>;

export type DeleteHouseholdAction = (
  householdId: string,
) => Promise<Guarded<DeleteHouseholdResult>>;

export type ResetInviteAction = (householdId: string) => Promise<Guarded<ResetInviteResult>>;

export type BulkInviteAction = (
  eventId: string,
  invited: boolean,
  tag: string | null,
) => Promise<Guarded<BulkInviteResult>>;

export type CommitImportAction = (input: unknown) => Promise<Guarded<CommitImportResult>>;

export type SaveSettingsAction = (input: unknown) => Promise<Guarded<SaveSettingsResult>>;
