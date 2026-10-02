import type { Guarded } from "@/admin/site/action-types";
import type {
  AddAdminResult,
  BackupResult,
  DeleteSiteResult,
  GrantResult,
  GuestPinToggleResult,
  PinResult,
  RemoveAdminResult,
  RevokeResult,
} from "./server";

/** Tvary Server Actions přístupu (M7b): prostá data, nikdy výjimka ani adresy. */
export type AccessActions = {
  addAdmin: (email: string) => Promise<Guarded<AddAdminResult>>;
  removeAdmin: (adminId: string) => Promise<Guarded<RemoveAdminResult>>;
  setBackupEmail: (email: string) => Promise<Guarded<BackupResult>>;
  changePin: (role: "admin" | "guest", pin: string) => Promise<Guarded<PinResult>>;
  setGuestPinEnabled: (enabled: boolean) => Promise<Guarded<GuestPinToggleResult>>;
  grant: (input: { reason: string; days: number }) => Promise<Guarded<GrantResult>>;
  revoke: (grantId: string) => Promise<Guarded<RevokeResult>>;
};

export type DeleteSiteAction = (confirmation: string) => Promise<Guarded<DeleteSiteResult>>;
