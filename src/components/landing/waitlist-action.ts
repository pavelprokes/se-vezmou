"use server";

import { headers } from "next/headers";
import { HONEYPOT_FIELD, submitWaitlist } from "@/lib/waitlist";
import type { WaitlistFormState } from "./waitlist-state";

/**
 * Server Action čekací listiny. Úvodní stránka je veřejná, proto se neověřuje relace; ověřuje se
 * vstup (zod v `submitWaitlist`), past na roboty a počet požadavků z jedné adresy.
 * Do logu se nedostane e-mail ani IP adresa.
 */
export async function joinWaitlist(
  _previous: WaitlistFormState,
  formData: FormData,
): Promise<WaitlistFormState> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientKey = forwarded || requestHeaders.get("x-real-ip") || undefined;

  const email = formData.get("email");
  const result = await submitWaitlist({
    email,
    consent: formData.get("consent"),
    locale: formData.get("locale"),
    honeypot: formData.get(HONEYPOT_FIELD),
    clientKey,
  });

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
