import { z } from "zod";
import { defaultLocale, locales, type Locale } from "@/i18n/config";
import { EMAIL_MAX_LENGTH, HONEYPOT_FIELD } from "./waitlist-fields";

/**
 * Čekací listina (MVP). Logika je za rozhraními; skutečné adaptéry nad tabulkou `waitlist` a nad
 * omezením počtu požadavků (`rate_limits`) jsou v `waitlist-db.ts` (jen server). Zápis je
 * idempotentní (stejný e-mail podruhé = stejná odpověď) a nic neprozrazuje.
 */

export { EMAIL_MAX_LENGTH, HONEYPOT_FIELD };

/**
 * Verze textu souhlasu, který se uživateli u formuláře zobrazil (`waitlist.consent_text_version`).
 * Při každé změně textu souhlasu v `landing.json` ji zvyšte, aby šlo doložit, s čím pár souhlasil.
 */
export const WAITLIST_CONSENT_VERSION = "2026-10-v1";

export type WaitlistFieldError = "required" | "invalid";

export interface WaitlistErrors {
  email?: WaitlistFieldError;
  consent?: "required";
}

const emailSchema = z
  .string({ error: "required" })
  .trim()
  .min(1, { error: "required" })
  .max(EMAIL_MAX_LENGTH, { error: "invalid" })
  .toLowerCase()
  .pipe(z.email({ error: "invalid" }));

export const waitlistSchema = z.object({
  email: emailSchema,
  /** Souhlas se zpracováním e-mailu pro oznámení spuštění (musí být výslovně zaškrtnutý). */
  consent: z.literal(true, { error: "required" }),
  locale: z.enum(locales).catch(defaultLocale),
});

export interface WaitlistEntry {
  email: string;
  locale: Locale;
  consentAt: Date;
  /** Verze textu souhlasu (`WAITLIST_CONSENT_VERSION`). */
  consentTextVersion: string;
}

/** Nezpracovaný vstup z formuláře (hodnoty z `FormData` jsou `unknown`). */
export interface WaitlistInput {
  email?: unknown;
  consent?: unknown;
  locale?: unknown;
  /** Hodnota skrytého pole (`HONEYPOT_FIELD`); u člověka prázdná. */
  honeypot?: unknown;
  /** Klíč pro omezení počtu požadavků (např. IP adresa). Nikdy se nelogují. */
  clientKey?: string;
}

export type WaitlistResult =
  | { status: "success" }
  | { status: "invalid"; errors: WaitlistErrors }
  | { status: "rateLimited" }
  | { status: "error" };

/** Úložiště čekací listiny (adaptér nad tabulkou `waitlist`, `email citext unique`). */
export interface WaitlistStore {
  /** `created: false` při opakovaném e-mailu; volající to uživateli nesděluje (žádné vyzrazení). */
  add(entry: WaitlistEntry): Promise<{ created: boolean }>;
}

/** Omezení počtu požadavků (tabulka `rate_limits`); klíč nese hodnotu, kterou adaptér zahashuje. */
export interface RateLimiter {
  check(key: string): Promise<{ allowed: boolean }>;
}

export interface WaitlistDeps {
  store: WaitlistStore;
  rateLimiter: RateLimiter;
  now?: () => Date;
}

/** Převede chyby zodu na kódy chyb podle polí (texty doplňuje formulář z překladů). */
export function toFieldErrors(error: z.ZodError): WaitlistErrors {
  const errors: WaitlistErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === "email" && !errors.email) {
      errors.email = issue.message === "required" ? "required" : "invalid";
    }
    if (field === "consent") errors.consent = "required";
  }
  return errors;
}

export async function submitWaitlist(
  input: WaitlistInput,
  deps: WaitlistDeps,
): Promise<WaitlistResult> {
  // Vyplněná past: tváříme se, že vše dopadlo dobře, a nic neukládáme.
  if (typeof input.honeypot === "string" && input.honeypot.trim() !== "") {
    return { status: "success" };
  }

  if (input.clientKey) {
    try {
      const { allowed } = await deps.rateLimiter.check(`waitlist:${input.clientKey}`);
      if (!allowed) return { status: "rateLimited" };
    } catch {
      // Selhání úložiště omezení = zavřeně (ADR 0010); bez podrobností, klíč nese IP adresu.
      console.error("[waitlist] omezení počtu požadavků selhalo");
      return { status: "error" };
    }
  }

  const parsed = waitlistSchema.safeParse({
    email: input.email,
    consent: input.consent === true || input.consent === "on",
    locale: input.locale,
  });
  if (!parsed.success) return { status: "invalid", errors: toFieldErrors(parsed.error) };

  try {
    await deps.store.add({
      email: parsed.data.email,
      locale: parsed.data.locale,
      consentAt: (deps.now ?? (() => new Date()))(),
      consentTextVersion: WAITLIST_CONSENT_VERSION,
    });
  } catch {
    // Bez podrobností: chyba může nést e-mail.
    console.error("[waitlist] uložení selhalo");
    return { status: "error" };
  }
  return { status: "success" };
}
