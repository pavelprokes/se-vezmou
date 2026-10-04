"use server";

import { after } from "next/server";
import { PIN_LENGTH } from "@/auth/config";
import { unlockWithGuestPin } from "@/auth/guest-pin";
import { setGuestCookie } from "@/auth/guest-session";
import type { Defer } from "@/auth/login";
import { normalizePinInput } from "@/auth/pin";
import { getClientIp } from "@/auth/request";
import { formatPause } from "@/i18n/duration";
import type { RsvpState } from "@/lib/rsvp/form";
import { matchStep, submitStep, unlistedStep, type StepResult } from "@/lib/rsvp/service";
import {
  clearInvite,
  clearTicket,
  currentTicket,
  setTicket,
  tenantFromRequest,
} from "@/site/tenant-request";

/**
 * Server Actions webu páru: slepé ověření jména a RSVP (FR-RSVP-1 až 7) a PIN hostů (FR-PRIV-2).
 * Každá začíná kontrolou původu a určením svatby z hostitele; odpovědi nikdy neprozradí, co je
 * v seznamu hostů (docs/adr/0010-rate-limiting.md). Neočekávaná chyba se vrací jako obecný stav,
 * nikdy s textem výjimky (mohl by nést jména).
 */

const defer: Defer = (task) =>
  after(async () => {
    await task();
  });

const GENERIC: RsvpState = { stage: "name", error: "generic" };

async function applyTicket(result: StepResult): Promise<RsvpState> {
  if (result.ticket && "set" in result.ticket) await setTicket(result.ticket.set);
  else if (result.ticket && "clear" in result.ticket) await clearTicket();
  return result.state;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Krok 1: jméno -> domácnost. Neshoda, více shod, limit i zavřené RSVP vrací stejný stav. */
export async function matchAction(formData: FormData): Promise<RsvpState> {
  try {
    const tenant = await tenantFromRequest(formData.get("locale"));
    if (!tenant) return GENERIC;
    const result = await matchStep({
      weddingId: tenant.weddingId,
      slug: tenant.slug,
      ip: await getClientIp(),
      name: field(formData, "name"),
      locale: tenant.locale,
      honeypot: field(formData, "website"),
    });
    // ověřené jméno je novější volba než osobní odkaz: odpověď musí jít jeho domácnosti
    if (result.ticket && "set" in result.ticket) await clearInvite();
    return applyTicket(result);
  } catch (error) {
    console.error("[rsvp] ověření jména selhalo", error instanceof Error ? error.name : "");
    return GENERIC;
  }
}

/** Host mimo seznam: formulář bez ověření jména (jen když to pár povolil). */
export async function unlistedAction(formData: FormData): Promise<RsvpState> {
  try {
    const tenant = await tenantFromRequest(formData.get("locale"));
    if (!tenant) return GENERIC;
    return applyTicket(await unlistedStep({ weddingId: tenant.weddingId, locale: tenant.locale }));
  } catch (error) {
    console.error(
      "[rsvp] formulář hosta mimo seznam selhal",
      error instanceof Error ? error.name : "",
    );
    return GENERIC;
  }
}

/** Odeslání nebo úprava odpovědi. Lístek je v cookie, ne ve formuláři. */
export async function submitAction(formData: FormData): Promise<RsvpState> {
  try {
    const tenant = await tenantFromRequest(formData.get("locale"));
    if (!tenant) return GENERIC;
    const mode = field(formData, "mode") === "unlisted" ? "unlisted" : "listed";
    return applyTicket(
      await submitStep({
        weddingId: tenant.weddingId,
        slug: tenant.slug,
        ip: await getClientIp(),
        mode,
        ticket: mode === "listed" ? await currentTicket(tenant.weddingId) : null,
        form: formData,
        locale: tenant.locale,
        origin: tenant.origin,
        defer,
      }),
    );
  } catch (error) {
    console.error("[rsvp] odeslání selhalo", error instanceof Error ? error.name : "");
    return { stage: "form", error: "generic" };
  }
}

/** "Zadat jiné jméno": zahodí lístek i kód osobního odkazu (sdílené zařízení) a vrátí první krok. */
export async function resetAction(formData: FormData): Promise<RsvpState> {
  try {
    const tenant = await tenantFromRequest(formData.get("locale"));
    if (!tenant) return GENERIC;
    await clearTicket();
    await clearInvite();
    return { stage: "name" };
  } catch (error) {
    console.error("[rsvp] zahození lístku selhalo", error instanceof Error ? error.name : "");
    return GENERIC;
  }
}

export type PinState = {
  error?: "format" | "invalid" | "locked" | "limited" | "generic";
  /** U `locked`: pauza slovy ("15 minut"). */
  pause?: string;
  /** PIN je správný, relace hosta je nastavená a stránka se překreslí s odemčenými bloky. */
  unlocked?: boolean;
} | null;

/** PIN hostů: po úspěchu relace hosta v cookie a stránka se překreslí s citlivými bloky. */
export async function unlockAction(_prev: PinState, formData: FormData): Promise<PinState> {
  try {
    const tenant = await tenantFromRequest(formData.get("locale"));
    if (!tenant) return { error: "generic" };

    const pin = normalizePinInput(field(formData, "pin"));
    if (!new RegExp(`^[0-9]{${PIN_LENGTH.min},${PIN_LENGTH.max}}$`).test(pin)) {
      return { error: "format" };
    }

    const result = await unlockWithGuestPin({
      weddingId: tenant.weddingId,
      slug: tenant.slug,
      pin,
      ip: await getClientIp(),
    });
    switch (result.status) {
      case "ok":
        await setGuestCookie(result.token);
        return { unlocked: true };
      case "locked":
        return { error: "locked", pause: formatPause(result.retryAfter, tenant.locale) };
      case "limited":
        return { error: "limited" };
      case "invalid":
        return { error: "invalid" };
    }
  } catch (error) {
    // Úložiště omezení selhalo nebo databáze nejede: PIN selže zavřeně.
    console.error("[pin hostů] ověření selhalo", error instanceof Error ? error.name : "");
    return { error: "generic" };
  }
}
