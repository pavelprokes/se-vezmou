import "server-only";
import { assertSameOrigin } from "@/auth/request";
import { getSession, type AdminSession } from "@/auth/session";
import type { Guarded } from "./site/action-types";

/**
 * Společný začátek každé Server Action správy: kontrola původu požadavku (CSRF, docs/security-privacy.md
 * kap. 2) a ověření relace správce. Proxy není bezpečnostní hranice, každá akce si relaci ověřuje
 * sama a svatba je vždy ta z relace, nikdy z argumentu od klienta. Chyba se loguje jen názvem akce
 * a druhem chyby (argumenty nesou obsah webu a osobní údaje) a klient dostane obecný stav `error`.
 */
export async function guarded<T>(
  action: string,
  run: (session: AdminSession) => Promise<T>,
): Promise<Guarded<T>> {
  try {
    await assertSameOrigin();
  } catch {
    return { status: "error" };
  }
  try {
    const session = await getSession();
    if (!session) return { status: "unauthorized" };
    return await run(session);
  } catch (error) {
    console.error(`[správa] ${action} selhala`, error instanceof Error ? error.name : "Error");
    return { status: "error" };
  }
}
