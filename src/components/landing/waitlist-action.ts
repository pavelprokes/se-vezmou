"use server";

import { assertSameOrigin, getClientIp } from "@/auth/request";
import { dbWaitlistDeps } from "@/lib/waitlist-db";
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
    dbWaitlistDeps(),
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
    case "error":
      return { status: "error", email: typeof email === "string" ? email : undefined };
  }
}
