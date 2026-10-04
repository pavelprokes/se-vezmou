import "server-only";
import { createHash } from "node:crypto";
import { cache } from "react";
import { publicMediaIds, visitorIdentity } from "@/lib/db/media";
import { z } from "zod";
import { getGuestSession, guestIdentity } from "@/auth/guest-session";
import { READ_ONLY, resolveSlug, tenantRpc } from "@/lib/db/rpc";
import type { TenantIdentity } from "@/lib/db/transport";
import { getPublicSite, resolvePreview } from "@/lib/db/rpc-wizard";
import { liveMedia } from "./live-media";
import { previewToPublicContent } from "./preview";
import { templateKeys } from "./themes/palettes";
import { localeSchema, publicContentSchema, type PublicContent } from "./types";

/**
 * Obsah webu páru z databáze (FR-WEB-4, docs/data-model.md kap. 5.5).
 *
 * - `getPublicContent(slug)`: zveřejněný snímek (`site_versions.public_content`) přes `resolve_slug`
 *   (service role) a `get_public_site` s claimy `visitor`. Fáze a „rychlá změna“ se berou z živých
 *   hodnot databáze, ne ze snímku. Neexistující, nezveřejněná, smazaná i zablokovaná adresa
 *   dávají totéž: `null` (stejná 404, FR-PRIV-3). Fixtury zůstávají jen ve vývojovém katalogu.
 * - `getPreviewContent(slug, token)`: koncept podle neuhádnutelného odkazu (role `preview`).
 *   Každá neshoda je `null`.
 *
 * Citlivý obsah za PINem (`SensitiveContent`) se sem záměrně nedostává: načítá ho jen `loadGuestContext` (`./guest-context.ts`, M8) pro hosta s relací po PINu.
 */

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** SHA-256 tokenu pro `weddings.preview_token_hash` (token má 256 bitů entropie, pomalý hash netřeba). */
export function hashPreviewToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** Brána zamčeného webu: jen jména a vzhled, žádný obsah (`get_public_site` v režimu `locked`). */
const lockedGateSchema = z.object({
  partners: z.object({ a: z.string().min(1), b: z.string().min(1) }),
  locales: z.array(localeSchema).min(1),
  defaultLocale: localeSchema,
  template: z.enum(templateKeys),
  palette: z.string(),
});
export type LockedGate = z.infer<typeof lockedGateSchema>;

export type SiteState =
  | { kind: "published"; content: PublicContent }
  | { kind: "locked"; gate: LockedGate; weddingId: string };

/**
 * Stav zveřejněného webu pro návštěvníka. Zamčený web (heslo na celý web) vydá databáze bez relace hosta jen
 * jako bránu; host po PINu (nebo osobním odkazu, který relaci vydá) dostane obsah. `as` předá jinou totožnost
 * (správce u PDF oznámení), pak se relace hosta nehledá.
 */
async function getSiteStateUncached(
  slug: string,
  as: TenantIdentity | null,
): Promise<SiteState | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const resolved = await resolveSlug(slug);
  if (!resolved) return null;
  if (as !== null && as.weddingId !== resolved.weddingId) return null;

  type Raw = {
    mode?: string;
    phase?: string | null;
    content?: unknown;
    quick_notice?: unknown;
    locked?: unknown;
  } | null;
  let site = (
    as
      ? await tenantRpc<Raw>(as, "get_public_site", {}, "scalar", READ_ONLY)
      : await getPublicSite(resolved.weddingId, "visitor")
  ) as Raw;

  if (site?.mode === "locked") {
    const access = await getGuestSession(resolved.weddingId);
    if (!access) {
      const gate = lockedGateSchema.safeParse(site.locked);
      if (!gate.success) {
        console.error("[site] brána zamčeného webu neodpovídá schématu");
        return null;
      }
      return { kind: "locked", gate: gate.data, weddingId: resolved.weddingId };
    }
    site = await tenantRpc<Raw>(guestIdentity(access), "get_public_site", {}, "scalar", READ_ONLY);
  }
  if (!site || site.mode !== "published" || typeof site.content !== "object" || !site.content) {
    return null;
  }

  const parsed = publicContentSchema.safeParse({
    ...site.content,
    phase: site.phase ?? undefined,
    quickNotice: site.quick_notice ?? null,
  });
  if (!parsed.success) {
    // Poškozený snímek se tváří jako neexistující web; chyba se hlásí bez obsahu snímku.
    console.error("[site] zveřejněný snímek neodpovídá schématu");
    return null;
  }
  return { kind: "published", content: await withLiveMedia(parsed.data, resolved.weddingId) };
}

/**
 * Stav webu. `cache` z Reactu: `generateMetadata` a stránka v jednom požadavku sdílejí jeden výsledek
 * (jeden `resolve_slug`, jeden `get_public_site`, jeden `public_media_ids`) místo dvou. Platí jen pro jedno
 * vykreslení; mezi požadavky se nic nesdílí, takže zveřejnění nové verze se projeví hned (sdílenou mezipaměť
 * snímku tenhle krok záměrně nezavádí, viz PR).
 */
export const getSiteState = cache(
  (slug: string, as: TenantIdentity | null = null): Promise<SiteState | null> =>
    getSiteStateUncached(slug, as),
);

/** Zveřejněný obsah webu; zamčený web bez relace hosta i neexistující web dávají `null`. */
export async function getPublicContent(
  slug: string,
  as: TenantIdentity | null = null,
): Promise<PublicContent | null> {
  const state = await getSiteState(slug, as);
  return state?.kind === "published" ? state.content : null;
}

/**
 * Smazaná fotografie zmizí z webu hned, i když zveřejněný snímek na ni ještě odkazuje: média, která už v databázi
 * nejsou hotová, se vyřadí (`public_media_ids`). Selhání dotazu snímek nemění (obrázek by se nedoručil, 404).
 */
async function withLiveMedia(content: PublicContent, weddingId: string): Promise<PublicContent> {
  if (content.media.every((item) => item.widths.length === 0)) return content;
  try {
    const alive = new Set(
      (await publicMediaIds(visitorIdentity(weddingId))).map((id) => id.toLowerCase()),
    );
    return { ...content, media: liveMedia(content.media, alive) };
  } catch {
    return content;
  }
}

export async function getPreviewContent(
  slug: string,
  token: string,
  now: Date = new Date(),
): Promise<PublicContent | null> {
  if (!SLUG_PATTERN.test(slug) || !TOKEN_PATTERN.test(token)) return null;
  const weddingId = await resolvePreview(slug, hashPreviewToken(token));
  if (!weddingId) return null;

  const raw = await getPublicSite(weddingId, "preview");
  if (!raw) return null;
  const content = previewToPublicContent(raw, slug, now);
  if (!content) console.error("[site] koncept neodpovídá schématu");
  return content;
}
