"use server";

import { RATE_RULES } from "@/auth/config";
import { hashToken } from "@/auth/crypto";
import { rateKey } from "@/auth/rate-limit";
import { assertSameOrigin, getClientIp } from "@/auth/request";
import { requireEnv } from "@/env";
import { rateLimitHit } from "@/lib/db/rpc";
import { waitlistConfirm } from "@/lib/db/rpc-wizard";
import { dbWaitlistDeps } from "@/lib/waitlist-db";
import { TURNSTILE_FIELD, verifyTurnstile } from "@/lib/turnstile";
import { HONEYPOT_FIELD, submitWaitlist } from "@/lib/waitlist";
import type { WaitlistFormState } from "./waitlist-state";

/**
 * Server Action čekací listiny. Úvodní stránka je veřejná, proto se neověřuje relace; ověřuje se
 * vstup (zod v `submitWaitlist`), past na roboty a počet požadavků z jedné adresy (databáze,
 * klíč je HMAC). Zápis je idempotentní: stejný e-mail podruhé dá stejnou odpověď. Do logu se
 * nedostane e-mail ani IP adresa.
 */
export async function joinWaitlist(
  _previous: WaitlistFormState,
  formData: FormData,
): Promise<WaitlistFormState> {
  const email = formData.get("email");
  // Mutace začíná kontrolou původu (CSRF, docs/security-privacy.md kap. 2), stejně jako ve správě.
  try {
    await assertSameOrigin();
  } catch {
    return { status: "error", email: typeof email === "string" ? email.slice(0, 254) : undefined };
  }
  const clientKey = await getClientIp();

  const result = await submitWaitlist(
    {
      email,
      consent: formData.get("consent"),
      locale: formData.get("locale"),
      honeypot: formData.get(HONEYPOT_FIELD),
      clientKey,
    },
    {
      ...dbWaitlistDeps(),
      // ochrana před roboty (Turnstile): widget vloží token do skrytého pole formuláře
      verifyHuman: async () =>
        (await verifyTurnstile(formData.get(TURNSTILE_FIELD), clientKey, "waitlist")) !== "bot",
    },
  );

  switch (result.status) {
    case "success":
      return { status: "success" };
    case "invalid":
      return {
        status: "invalid",
        errors: result.errors,
        email: typeof email === "string" ? email.slice(0, 254) : undefined,
      };
    case "rateLimited":
      return { status: "rateLimited", email: typeof email === "string" ? email : undefined };
    case "bot":
      return { status: "bot", email: typeof email === "string" ? email : undefined };
    case "error":
      return { status: "error", email: typeof email === "string" ? email : undefined };
  }
}

export type WaitlistConfirmState = { status: "idle" | "confirmed" | "invalid" | "error" };

/**
 * Potvrzení zápisu na čekací listinu tlačítkem na stránce z odkazu v e-mailu (ne samotným otevřením odkazu, to
 * dělají i skenery pošty). Token je jednorázový a platí 7 dní; neplatný, prošlý a použitý odkaz dají stejnou
 * odpověď. Omezení podle IP brání zkoušení tokenů (mají 256 bitů, jde spíš o šetrnost k databázi).
 */
export async function confirmWaitlistAction(
  _previous: WaitlistConfirmState,
  formData: FormData,
): Promise<WaitlistConfirmState> {
  try {
    await assertSameOrigin();
  } catch {
    return { status: "error" };
  }
  const token = formData.get("t");
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { status: "invalid" };
  try {
    const rule = RATE_RULES.waitlistIp;
    const limit = await rateLimitHit(
      rateKey(requireEnv("RATE_LIMIT_SECRET"), "waitlist-confirm-ip", await getClientIp()),
      rule.limit,
      rule.windowSeconds,
    );
    if (!limit.allowed) return { status: "error" };
    return (await waitlistConfirm(hashToken(token)))
      ? { status: "confirmed" }
      : { status: "invalid" };
  } catch {
    console.error("[waitlist] potvrzení selhalo");
    return { status: "error" };
  }
}
