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

export async function verifyTurnstile(
  token: unknown,
  ip: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return "skipped";
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
    const result = (await response.json()) as { success?: boolean };
    return result.success === true ? "ok" : "bot";
  } catch (error) {
    console.error("[turnstile] ověření selhalo", error instanceof Error ? error.name : "");
    return "ok";
  }
}
