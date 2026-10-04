import "server-only";
import { env } from "@/env";

/**
 * Cloudflare Turnstile: ověření tokenu z widgetu na serveru (siteverify). Bez tajného klíče se ověření
 * přeskočí (vývoj, automatické testy). Výslovně neplatný, prošlý nebo chybějící token = robot. Výpadek
 * služby Cloudflare formulář nezablokuje (selže otevřeně): dál platí omezení počtu požadavků a ověření
 * e-mailem, takže krátký výpadek nemá bránit skutečným párům.
 */

export const TURNSTILE_FIELD = "cf-turnstile-response";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = "ok" | "skipped" | "bot";

/** Chyby nastavení na naší straně: ověření nesmí kvůli nim odmítat skutečné páry (selže otevřeně s chybou v logu). */
const CONFIG_ERRORS = new Set(["missing-input-secret", "invalid-input-secret", "internal-error"]);

export async function verifyTurnstile(
  token: unknown,
  ip: string | null,
  /** Očekávaná akce widgetu (`wizard`, `waitlist`): token jednoho formuláře neplatí pro druhý. */
  action: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  const secret = env.TURNSTILE_SECRET_KEY;
  // Jen s oběma klíči: bez veřejného klíče v sestavení se widget nevykreslí a token by nikdy nepřišel.
  if (!secret || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return "skipped";
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return "bot";
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const response = await fetchImpl(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      console.error("[turnstile] ověření nedostupné", response.status);
      return "ok";
    }
    const result = (await response.json()) as {
      success?: boolean;
      action?: string;
      "error-codes"?: string[];
    };
    const codes = result["error-codes"] ?? [];
    if (codes.some((code) => CONFIG_ERRORS.has(code))) {
      console.error("[turnstile] chyba nastavení, ověření přeskočeno", codes.join(","));
      return "ok";
    }
    if (result.success !== true) return "bot";
    return result.action === undefined || result.action === action ? "ok" : "bot";
  } catch (error) {
    console.error("[turnstile] ověření selhalo", error instanceof Error ? error.name : "");
    return "ok";
  }
}
