import { z } from "zod";
import { defaultLocale, locales, type Locale } from "@/i18n/config";
import { EMAIL_MAX_LENGTH, HONEYPOT_FIELD } from "./waitlist-fields";

/**
 * Čekací listina (MVP). Logika je za rozhraními, takže napojení na databázi (M3) a omezení
 * počtu požadavků (`rate_limits`, technical-design 4) jen vymění adaptér, ne formulář ani akci.
 */

export { EMAIL_MAX_LENGTH, HONEYPOT_FIELD };

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

/** Úložiště čekací listiny. M3 doplní adaptér nad tabulkou `waitlist` (`email citext unique`). */
export interface WaitlistStore {
  /** `created: false` při opakovaném e-mailu; volající to uživateli nesděluje (žádné vyzrazení). */
  add(entry: WaitlistEntry): Promise<{ created: boolean }>;
}

/** Hák pro omezení počtu požadavků; skutečná implementace (tabulka `rate_limits`) přijde v M3. */
export interface RateLimiter {
  check(key: string): Promise<{ allowed: boolean }>;
}

export const unlimitedRateLimiter: RateLimiter = {
  async check() {
    return { allowed: true };
  },
};

/**
 * Dočasný adaptér: záznam jen zaloguje, BEZ e-mailu a dalších osobních údajů, a hlásí úspěch.
 *
 * TODO(M3): nahradit adaptérem nad tabulkou `waitlist` (docs/data-model.md 3.7: `email citext
 * unique`, `locale`, `consent_at`, `consent_text_version`), volání přes `security definer`
 * funkci. Do té doby se e-maily NEUKLÁDAJÍ, proto stránku s čekací listinou nezveřejňovat
 * před dokončením M3.
 */
export const logOnlyWaitlistStore: WaitlistStore = {
  async add(entry) {
    console.info("[waitlist] záznam přijat (zatím neuložen)", { locale: entry.locale });
    return { created: true };
  },
};

export interface WaitlistDeps {
  store: WaitlistStore;
  rateLimiter: RateLimiter;
  now?: () => Date;
}

export const defaultWaitlistDeps: WaitlistDeps = {
  store: logOnlyWaitlistStore,
  rateLimiter: unlimitedRateLimiter,
};

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
  deps: WaitlistDeps = defaultWaitlistDeps,
): Promise<WaitlistResult> {
  // Vyplněná past: tváříme se, že vše dopadlo dobře, a nic neukládáme.
  if (typeof input.honeypot === "string" && input.honeypot.trim() !== "") {
    return { status: "success" };
  }

  if (input.clientKey) {
    const { allowed } = await deps.rateLimiter.check(`waitlist:${input.clientKey}`);
    if (!allowed) return { status: "rateLimited" };
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
    });
  } catch {
    // Bez podrobností: chyba může nést e-mail. Skutečné logování s Sentry doplní M3.
    console.error("[waitlist] uložení selhalo");
    return { status: "error" };
  }
  return { status: "success" };
}
