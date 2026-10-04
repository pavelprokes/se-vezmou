import "server-only";
import { getGuestSession, guestIdentity } from "@/auth/guest-session";
import type { Locale } from "@/i18n/config";
import { publicMediaIds } from "@/lib/db/media";
import { READ_ONLY, resolveSlug, tenantRpc } from "@/lib/db/rpc";
import { fetchInviteInfo, fetchRsvpInfo } from "@/lib/rsvp/db";
import type { RsvpSiteState } from "@/lib/rsvp/form";
import { initialState } from "@/lib/rsvp/service";
import { liveMedia } from "./live-media";
import { readInvite, readTicket } from "./tenant-request";
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
  /** Host přišel osobním odkazem: události, na které je jeho domácnost pozvaná, a všechny s potvrzováním. */
  invite: { invited: string[]; rsvp: string[] } | null;
}

/**
 * Citlivá část snímku po částech: neplatná část (např. starší snímek s IBAN, který neprojde kontrolou) se
 * vynechá, ostatní zůstanou. Dřív neplatná část zahodila všechno a host se po správném PINu vracel na formulář.
 */
export function parseSensitiveLeniently(raw: unknown): SensitiveContent {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const shape = sensitiveContentSchema.shape;
  const part = <K extends keyof typeof shape>(key: K): SensitiveContent[K] => {
    const parsed = shape[key].safeParse(source[key]);
    return (parsed.success ? parsed.data : shape[key].parse(undefined)) as SensitiveContent[K];
  };
  return {
    venues: part("venues"),
    gallery: part("gallery"),
    photos: part("photos"),
    gifts: part("gifts"),
  };
}

export async function loadGuestContext(slug: string, locale: Locale): Promise<GuestContext | null> {
  try {
    const resolved = await resolveSlug(slug);
    if (!resolved) return null;
    const weddingId = resolved.weddingId;

    const info = await fetchRsvpInfo(weddingId);
    if (!info) return null;

    const code = await readInvite();
    const [{ state }, invite] = await Promise.all([
      readTicket().then((ticket) => initialState({ weddingId, ticket, invite: code, locale })),
      code ? fetchInviteInfo(weddingId, code) : null,
    ]);

    // Host s platnou relací po PINu dostane citlivou část snímku; bez ní se nenačítá vůbec.
    let sensitive: SensitiveContent | null = null;
    const access = await getGuestSession(weddingId);
    if (access) {
      const site = await tenantRpc<{ sensitive?: unknown } | null>(
        guestIdentity(access),
        "get_public_site",
        {},
        "scalar",
        READ_ONLY,
      );
      sensitive = parseSensitiveLeniently(site?.sensitive);
      // Smazaná fotografie zmizí i z chráněné části hned (viz `getPublicContent`)
      if (sensitive.photos.length > 0) {
        try {
          const alive = new Set(
            (await publicMediaIds(guestIdentity(access))).map((id) => id.toLowerCase()),
          );
          sensitive = { ...sensitive, photos: liveMedia(sensitive.photos, alive) };
        } catch {
          // beze změny: doručení smazanou fotografii stejně nepodá
        }
      }
    }

    return {
      phase: info.phase,
      rsvp: { initial: state, allowUnlisted: info.allow_unlisted, closesAt: info.closes_at },
      sensitiveUnlocked: access !== null,
      sensitive,
      invite: invite ? { invited: invite.event_ids, rsvp: invite.rsvp_event_ids } : null,
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
