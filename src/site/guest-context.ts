import "server-only";
import { getGuestSession, guestIdentity } from "@/auth/guest-session";
import type { Locale } from "@/i18n/config";
import { resolveSlug, tenantRpc } from "@/lib/db/rpc";
import { fetchRsvpInfo } from "@/lib/rsvp/db";
import type { RsvpSiteState } from "@/lib/rsvp/form";
import { initialState } from "@/lib/rsvp/service";
import { readTicket } from "./tenant-request";
import { sensitiveContentSchema, type Phase, type SensitiveContent } from "./types";

/**
 * Co o hostovi ví stránka webu páru za běhu (nad rámec zveřejněného snímku): živá fáze RSVP
 * z databáze, stav formuláře (platný lístek v cookie otevře dřívější odpověď) a citlivé bloky pro
 * hosta s relací po PINu. Bez PINu se citlivý obsah z databáze vůbec nenačítá, takže se nemůže
 * dostat do HTML ani do RSC payloadu (FR-PRIV-2).
 *
 * Web bez záznamu v databázi (vývojová fixtura) nebo při výpadku databáze vrací `null`: stránka se
 * vykreslí jen ze snímku a formulář RSVP bez ověřitelné svatby nic neodešle.
 */

export interface GuestContext {
  /** Fáze spočítaná databází teď, ne uložená ve snímku. */
  phase: Phase;
  rsvp: RsvpSiteState;
  sensitiveUnlocked: boolean;
  sensitive: SensitiveContent | null;
}

export async function loadGuestContext(slug: string, locale: Locale): Promise<GuestContext | null> {
  try {
    const resolved = await resolveSlug(slug);
    if (!resolved) return null;
    const weddingId = resolved.weddingId;

    const info = await fetchRsvpInfo(weddingId);
    if (!info) return null;

    const { state } = await initialState({ weddingId, ticket: await readTicket(), locale });

    // Host s platnou relací po PINu dostane citlivou část snímku; bez ní se nenačítá vůbec.
    let sensitive: SensitiveContent | null = null;
    const access = await getGuestSession(weddingId);
    if (access) {
      const site = await tenantRpc<{ sensitive?: unknown } | null>(
        guestIdentity(access),
        "get_public_site",
      );
      const parsed = sensitiveContentSchema.safeParse(site?.sensitive ?? {});
      sensitive = parsed.success ? parsed.data : sensitiveContentSchema.parse({});
    }

    return {
      phase: info.phase,
      rsvp: { initial: state, allowUnlisted: info.allow_unlisted, closesAt: info.closes_at },
      sensitiveUnlocked: access !== null,
      sensitive,
    };
  } catch (error) {
    // Bez osobních údajů: jen druh chyby. Stránka se vykreslí bez živých údajů.
    console.error(
      "[web páru] živá data hosta nejsou k dispozici",
      error instanceof Error ? error.name : "",
    );
    return null;
  }
}
