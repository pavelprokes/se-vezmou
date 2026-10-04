"use server";

import { appHref } from "@/admin/paths";
import { after } from "next/server";
import { guarded } from "@/admin/guard";
import {
  addAdmin,
  changePin,
  grantAccess,
  removeAdmin,
  revokeAccess,
  setBackupEmail,
  setGuestPinEnabled,
  setSiteLocked,
  type AccessActor,
  type AccessContext,
  type AddAdminResult,
  type BackupResult,
  type GrantResult,
  type GuestPinToggleResult,
  type SiteLockResult,
  type PinResult,
  type RemoveAdminResult,
  type RevokeResult,
} from "@/admin/access/server";
import type { Guarded } from "@/admin/site/action-types";
import { appOrigin, currentHostConfig } from "@/auth/app-origin";
import { getHost, getUiLocale } from "@/auth/request";
import type { AdminSession } from "@/auth/session";

/**
 * Server Actions přístupu ke správě webu (M7b): správci, záložní e-mail, PIN, souhlas s nahlédnutím.
 * Každá začíná kontrolou původu a relace (`guarded`); oznámení ostatním správcům se odesílají po
 * odpovědi (`after`) a nikdy neblokují změnu. Adresy a PIN se nelogují.
 */

function actor(session: AdminSession): AccessActor {
  return {
    weddingId: session.weddingId,
    subjectId: session.subjectId,
    sessionId: session.sessionId,
  };
}

async function context(): Promise<AccessContext> {
  const host = await getHost();
  const locale = await getUiLocale();
  return {
    locale,
    loginUrl: `${appOrigin(host, currentHostConfig())}${appHref("/prihlaseni", locale)}`,
    defer: (task) =>
      after(async () => {
        await task();
      }),
  };
}

export async function addAdminAction(email: string): Promise<Guarded<AddAdminResult>> {
  return guarded("přidání správce", async (session) =>
    addAdmin(actor(session), await context(), email),
  );
}

export async function removeAdminAction(adminId: string): Promise<Guarded<RemoveAdminResult>> {
  return guarded("odebrání správce", async (session) =>
    removeAdmin(actor(session), await context(), adminId),
  );
}

export async function setBackupEmailAction(email: string): Promise<Guarded<BackupResult>> {
  return guarded("změna záložního e-mailu", async (session) =>
    setBackupEmail(actor(session), await context(), email),
  );
}

export async function changePinAction(
  role: "admin" | "guest",
  pin: string,
): Promise<Guarded<PinResult>> {
  return guarded("změna PINu", async (session) => {
    if (role !== "admin" && role !== "guest")
      return { status: "invalid" as const, problem: "format" as const };
    return changePin(actor(session), await context(), role, pin);
  });
}

export async function setGuestPinEnabledAction(
  enabled: boolean,
): Promise<Guarded<GuestPinToggleResult>> {
  return guarded("přepnutí PINu hostů", (session) => setGuestPinEnabled(actor(session), enabled));
}

export async function setSiteLockedAction(locked: boolean): Promise<Guarded<SiteLockResult>> {
  return guarded("zámek webu", (session) => setSiteLocked(actor(session), locked));
}

export async function grantAccessAction(input: {
  reason: string;
  days: number;
}): Promise<Guarded<GrantResult>> {
  return guarded("udělení souhlasu", async (session) =>
    grantAccess(actor(session), await context(), input),
  );
}

export async function revokeAccessAction(grantId: string): Promise<Guarded<RevokeResult>> {
  return guarded("odvolání souhlasu", async (session) =>
    revokeAccess(actor(session), await context(), grantId),
  );
}
