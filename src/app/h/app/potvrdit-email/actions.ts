"use server";

import { confirmBackupEmail } from "@/auth/backup-confirm";
import { assertSameOrigin } from "@/auth/request";

export type ConfirmState = "confirmed" | "invalid" | "generic" | null;

/** Potvrzení záložního e-mailu odesláním formuláře (samotné otevření odkazu nic nepotvrdí). */
export async function confirmBackupAction(
  _prev: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  try {
    await assertSameOrigin();
  } catch {
    return "generic";
  }
  const token = formData.get("t");
  if (typeof token !== "string") return "invalid";
  try {
    return (await confirmBackupEmail(token)) ? "confirmed" : "invalid";
  } catch {
    return "generic";
  }
}
