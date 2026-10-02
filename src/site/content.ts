import "server-only";
import { createHash } from "node:crypto";
import { resolveSlug } from "@/lib/db/rpc";
import { getPublicSite, resolvePreview } from "@/lib/db/rpc-wizard";
import { previewToPublicContent } from "./preview";
import { publicContentSchema, type PublicContent } from "./types";

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

export async function getPublicContent(slug: string): Promise<PublicContent | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const resolved = await resolveSlug(slug);
  if (!resolved) return null;

  const site = (await getPublicSite(resolved.weddingId, "visitor")) as {
    mode?: string;
    phase?: string | null;
    content?: unknown;
    quick_notice?: unknown;
  } | null;
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
  return parsed.data;
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
