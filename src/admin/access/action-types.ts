import type { Guarded } from "@/admin/site/action-types";
import type {
  AddAdminResult,
  BackupConfirmSendResult,
  BackupResult,
  DeleteSiteResult,
  GrantResult,
  GuestPinToggleResult,
  PinResult,
  RemoveAdminResult,
  RevokeResult,
  SiteLockResult,
} from "./server";

/** Tvary Server Actions přístupu (M7b): prostá data, nikdy výjimka ani adresy. */
export type AccessActions = {
  addAdmin: (email: string) => Promise<Guarded<AddAdminResult>>;
  removeAdmin: (adminId: string) => Promise<Guarded<RemoveAdminResult>>;
  setBackupEmail: (email: string) => Promise<Guarded<BackupResult>>;
  sendBackupConfirmation: () => Promise<Guarded<BackupConfirmSendResult>>;
  changePin: (role: "admin" | "guest", pin: string) => Promise<Guarded<PinResult>>;
  setGuestPinEnabled: (enabled: boolean) => Promise<Guarded<GuestPinToggleResult>>;
  setSiteLocked: (locked: boolean) => Promise<Guarded<SiteLockResult>>;
  grant: (input: { reason: string; days: number }) => Promise<Guarded<GrantResult>>;
  revoke: (grantId: string) => Promise<Guarded<RevokeResult>>;
};

export type DeleteSiteAction = (confirmation: string) => Promise<Guarded<DeleteSiteResult>>;
