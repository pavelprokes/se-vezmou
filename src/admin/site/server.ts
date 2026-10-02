import "server-only";
import { RATE_RULES, type RateRule } from "@/auth/config";
import { rateKey } from "@/auth/rate-limit";
import { requireEnv } from "@/env";
import {
  adminMyWeddings,
  adminQuickNoticeSet,
  adminSiteCheckpoint,
  adminSiteLoad,
  adminSitePublish,
  adminSiteSave,
  adminSiteUnpublish,
  adminSiteVersionGet,
  type AdminIdentity,
  type MyWedding,
} from "@/lib/db/admin-site";
import { rateLimitHit } from "@/lib/db/rpc";
import { analyticsRecord } from "@/lib/db/rpc-wizard";
import { DbError } from "@/lib/db/transport";
import {
  cleanText,
  docToPublic,
  docToWork,
  editorDocSchema,
  parseLoaded,
  publicToDoc,
  reconcileGalleryMedia,
  validateDoc,
} from "./doc";
import type { EditorDoc, Issue, LoadedSite, SiteMeta } from "./doc";
import { fetchOgCard, fetchOgImage, type OgFailure } from "./og";
import { listMedia, pruneCardImages, storeCardImage } from "@/lib/media/service";
import { normalizeHttpsUrl } from "./normalize";
import { hasPalette } from "@/site/themes/palettes";
import { publicContentSchema, sensitiveContentSchema, type GalleryCard } from "@/site/types";
import type { I18nText } from "@/site/i18n-text";
import { z } from "zod";

/**
 * Serverová logika správy webu (M7a) bez závislosti na Next.js: omezení počtu požadavků, ukládání
 * pracovní kopie (optimistické zamykání), zveřejnění, stažení z publikace, body pro vrácení,
 * vrácení verze, rychlá změna a karta externí galerie. Každá funkce dostává relaci správce
 * (`AdminIdentity`) z volající Server Action; svatba je vždy ta z relace. Do logu se nic
 * z obsahu webu ani osobní údaje nedostanou.
 */

export type { AdminIdentity };

async function limited(scope: string, weddingId: string, rule: RateRule): Promise<number | null> {
  const result = await rateLimitHit(
    rateKey(requireEnv("RATE_LIMIT_SECRET"), scope, weddingId),
    rule.limit,
    rule.windowSeconds,
  );
  return result.allowed ? null : result.retryAfter;
}

function reasonOf(error: unknown): string | undefined {
  return error instanceof DbError ? error.reason : undefined;
}

/** Svatba je po prvním zveřejnění pod správou (jinak ji drží průvodce). */
export function isManaged(meta: SiteMeta): boolean {
  return meta.publishedVersionNo !== null || meta.status === "published";
}

const FIRST_VERSION_SAVE = "site_not_editable";

/** Poslední verze je starší než půl hodiny: při otevření editoru se uloží bod pro vrácení. */
const CHECKPOINT_AFTER_MS = 30 * 60 * 1000;

/**
 * Má se při otevření editoru zachytit stav před úpravami? Jen když koncept nese nezveřejněné změny
 * (jinak je shodný se zveřejněnou verzí) a poslední verze je stará, takže se historie nezahlcuje.
 */
export function checkpointDue(loaded: LoadedSite, now: number = Date.now()): boolean {
  if (!loaded.meta.hasUnpublishedChanges) return false;
  const latest = loaded.versions[0];
  return !latest || now - new Date(latest.createdAt).getTime() > CHECKPOINT_AFTER_MS;
}

/** Stav webu jen ke čtení (přehled): nic nezapisuje ani neinicializuje pracovní kopii. */
export async function peekSite(session: AdminIdentity): Promise<LoadedSite | null> {
  return parseLoaded(await adminSiteLoad(session));
}

/**
 * Načte web pro editor. Pracovní kopie bez bloků (svatba zveřejněná mimo průvodce) se jednorázově
 * naplní ze zveřejněné verze, aby editor nikdy nezačínal prázdný nad zveřejněným webem.
 */
export async function loadSite(session: AdminIdentity): Promise<LoadedSite | null> {
  const raw = await adminSiteLoad(session);
  const rawBlocks = (raw as { blocks?: unknown[] } | null)?.blocks;
  let loaded = parseLoaded(raw);
  if (!loaded) return null;

  const published = loaded.versions.find((version) => version.isPublished);
  if (published && Array.isArray(rawBlocks) && rawBlocks.length === 0) {
    const restored = await docFromVersion(session, published.id, loaded.meta.slug);
    if (restored) {
      try {
        await adminSiteSave(session, loaded.meta.rev, docToWork(restored), { touch: false });
        loaded = parseLoaded(await adminSiteLoad(session)) ?? loaded;
      } catch (error) {
        if (reasonOf(error) !== FIRST_VERSION_SAVE) throw error;
      }
    }
  }
  return loaded;
}

async function docFromVersion(
  session: AdminIdentity,
  versionId: string,
  slug: string | null,
): Promise<EditorDoc | null> {
  void slug;
  const version = z
    .object({ public_content: z.unknown(), sensitive_content: z.unknown() })
    .nullable()
    .safeParse(await adminSiteVersionGet(session, versionId));
  if (!version.success || !version.data) return null;
  const content = publicContentSchema.safeParse(version.data.public_content);
  const sensitive = sensitiveContentSchema.safeParse(version.data.sensitive_content ?? {});
  if (!content.success || !sensitive.success) return null;
  return publicToDoc(content.data, sensitive.data);
}

// --- ukládání ------------------------------------------------------------------------------------

export type SaveResult =
  | { status: "saved"; rev: number }
  | { status: "conflict"; rev: number }
  | { status: "invalid" }
  | { status: "not_editable" }
  | { status: "limited"; retryAfter: number };

/** Průběžné uložení pracovní kopie. Číslo revize chrání před přepsáním změn z jiného okna. */
export async function saveSite(
  session: AdminIdentity,
  input: { doc: unknown; baseRev: number },
): Promise<SaveResult> {
  const parsed = editorDocSchema.safeParse(input.doc);
  if (!parsed.success || !Number.isInteger(input.baseRev) || input.baseRev < 0) {
    return { status: "invalid" };
  }
  const doc = parsed.data;
  // Dvojici šablona a paleta hlídá databáze jen částečně; neznámá paleta by rozbila vykreslení.
  if (!hasPalette(doc.wedding.template, doc.wedding.palette)) return { status: "invalid" };

  const retry = await limited("site-save-wedding", session.weddingId, RATE_RULES.siteSaveWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };

  try {
    const result = await adminSiteSave(session, input.baseRev, docToWork(doc));
    return result.conflict
      ? { status: "conflict", rev: result.rev }
      : { status: "saved", rev: result.rev };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "site_not_editable") return { status: "not_editable" };
    if (reason === "invalid_payload" || reason === "payload_too_large") {
      return { status: "invalid" };
    }
    // Porušení kontrolního omezení (např. datum konce před začátkem) je chyba vstupu, ne serveru.
    if (
      error instanceof DbError &&
      (error.code === "23514" || error.code === "22P02" || error.code === "22007")
    ) {
      return { status: "invalid" };
    }
    throw error;
  }
}

// --- zveřejnění ----------------------------------------------------------------------------------

export function guestPinReady(meta: SiteMeta): boolean {
  return meta.guestPinEnabled && meta.hasGuestPin;
}

export type PublishResult =
  | { status: "published"; versionNo: number; slug: string; warnings: Issue[] }
  | { status: "invalid"; issues: Issue[] }
  | { status: "not_publishable" }
  | { status: "limited"; retryAfter: number };

/**
 * Zveřejní uloženou pracovní kopii (ne to, co pošle klient): snímek se sestaví z databáze, projde
 * kontrolou obsahu (včetně `validatePalette`) a schématem veřejného snímku. Chybějící překlad
 * zveřejnění nebrání, jen se hlásí (FR-WEB-2).
 */
export async function publishSiteVersion(
  session: AdminIdentity,
  note?: string | null,
): Promise<PublishResult> {
  const retry = await limited(
    "site-version-wedding",
    session.weddingId,
    RATE_RULES.siteVersionWedding,
  );
  if (retry !== null) return { status: "limited", retryAfter: retry };

  const loaded = await loadSite(session);
  if (!loaded || !loaded.meta.slug) return { status: "not_publishable" };
  // Fotografie: do snímku jdou jen hotové a popsané (nebo dekorativní), ostatní se vynechají a nahlásí jako upozornění
  const media = await listMedia(session);
  const doc = reconcileGalleryMedia(loaded.doc, media);
  const issues = validateDoc(doc, { guestPinReady: guestPinReady(loaded.meta), media });
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) return { status: "invalid", issues };

  const built = docToPublic(doc, {
    slug: loaded.meta.slug,
    quickNotice: loaded.meta.quickNoticeEnabled ? loaded.meta.quickNotice : null,
    media,
  });
  if (!built)
    return { status: "invalid", issues: [{ code: "build", severity: "error", area: "wedding" }] };

  try {
    const result = await adminSitePublish(session, {
      publicContent: built.content,
      sensitive: built.sensitive,
      note: note?.trim().slice(0, 200) || null,
    });
    try {
      await analyticsRecord({
        event: "site_published",
        locale: loaded.doc.wedding.defaultLocale,
        template: loaded.doc.wedding.template,
      });
    } catch {
      console.error("[měření] událost se nepodařilo zapsat");
    }
    return {
      status: "published",
      versionNo: result.versionNo,
      slug: result.slug,
      warnings: issues.filter((issue) => issue.severity === "warning"),
    };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "wedding_not_publishable" || reason === "slug_not_reserved") {
      return { status: "not_publishable" };
    }
    if (reason === "guest_pin_missing") {
      return {
        status: "invalid",
        issues: [{ code: "guestPinMissing", severity: "error", area: "gifts" }],
      };
    }
    throw error;
  }
}

export type SimpleResult =
  { status: "ok" } | { status: "failed" } | { status: "limited"; retryAfter: number };

export async function unpublishSite(session: AdminIdentity): Promise<SimpleResult> {
  const retry = await limited(
    "site-version-wedding",
    session.weddingId,
    RATE_RULES.siteVersionWedding,
  );
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    await adminSiteUnpublish(session);
    return { status: "ok" };
  } catch (error) {
    if (reasonOf(error) === "wedding_not_published") return { status: "failed" };
    throw error;
  }
}

/** Bod pro vrácení z uložené pracovní kopie; neplatný (nehotový) obsah se nezachytává. */
export async function createCheckpoint(
  session: AdminIdentity,
  note: string | null,
  loadedSite?: LoadedSite,
): Promise<
  | { status: "ok"; versionNo: number }
  | { status: "invalid" }
  | { status: "limited"; retryAfter: number }
> {
  const retry = await limited(
    "site-version-wedding",
    session.weddingId,
    RATE_RULES.siteVersionWedding,
  );
  if (retry !== null) return { status: "limited", retryAfter: retry };
  const loaded = loadedSite ?? (await loadSite(session));
  if (!loaded || !loaded.meta.slug) return { status: "invalid" };
  const media = await listMedia(session);
  const built = docToPublic(reconcileGalleryMedia(loaded.doc, media), {
    slug: loaded.meta.slug,
    quickNotice: loaded.meta.quickNoticeEnabled ? loaded.meta.quickNotice : null,
    media,
  });
  if (!built) return { status: "invalid" };
  try {
    const versionNo = await adminSiteCheckpoint(session, {
      publicContent: built.content,
      sensitive: built.sensitive,
      note: note?.trim().slice(0, 200) || null,
    });
    return { status: "ok", versionNo };
  } catch (error) {
    if (reasonOf(error) === "site_not_editable") return { status: "invalid" };
    throw error;
  }
}

export type RestoreResult =
  | { status: "restored"; rev: number; versionNo: number }
  | { status: "not_found" }
  | { status: "conflict" }
  | { status: "not_editable" }
  | { status: "limited"; retryAfter: number };

/**
 * Vrácení verze: před přepsáním se současný stav uloží jako bod pro vrácení (návrat jde vrátit),
 * snímek verze se načte do pracovní kopie jako koncept. Nová publikace je výslovný další krok.
 */
export async function restoreVersion(
  session: AdminIdentity,
  versionId: string,
): Promise<RestoreResult> {
  const retry = await limited(
    "site-version-wedding",
    session.weddingId,
    RATE_RULES.siteVersionWedding,
  );
  if (retry !== null) return { status: "limited", retryAfter: retry };

  const loaded = await loadSite(session);
  if (!loaded) return { status: "not_found" };
  const version = loaded.versions.find((v) => v.id === versionId);
  if (!version) return { status: "not_found" };
  const doc = await docFromVersion(session, versionId, loaded.meta.slug);
  if (!doc) return { status: "not_found" };

  // Zachytit současný stav (když je platný); nehotový koncept se při vrácení přepíše bez bodu.
  await createCheckpoint(session, `Před vrácením verze ${version.versionNo}`, loaded).catch(
    () => undefined,
  );

  const reloaded = (await loadSite(session)) ?? loaded;
  try {
    const result = await adminSiteSave(session, reloaded.meta.rev, docToWork(doc));
    if (result.conflict) return { status: "conflict" };
    return { status: "restored", rev: result.rev, versionNo: version.versionNo };
  } catch (error) {
    if (reasonOf(error) === "site_not_editable") return { status: "not_editable" };
    throw error;
  }
}

// --- rychlá změna ----------------------------------------------------------------------------------

export const quickNoticeInputSchema = z.object({
  notice: z
    .object({ cs: z.string().max(500).optional(), en: z.string().max(500).optional() })
    .strict(),
  enabled: z.boolean(),
});

export type QuickNoticeResult =
  { status: "ok" } | { status: "empty" } | { status: "invalid" } | { status: "not_editable" };

export async function setQuickNotice(
  session: AdminIdentity,
  input: unknown,
): Promise<QuickNoticeResult> {
  const parsed = quickNoticeInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const notice = cleanText(parsed.data.notice as I18nText);
  if (parsed.data.enabled && !notice) return { status: "empty" };
  try {
    await adminQuickNoticeSet(
      session,
      notice as Record<string, string> | null,
      parsed.data.enabled,
    );
    return { status: "ok" };
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "site_not_editable") return { status: "not_editable" };
    if (reason === "notice_empty") return { status: "empty" };
    throw error;
  }
}

// --- karta externí galerie ---------------------------------------------------------------------------

export type GalleryCardResult =
  | { status: "ok"; card: GalleryCard }
  | { status: "failed"; reason: OgFailure; card: GalleryCard }
  | { status: "invalid_url" }
  | { status: "limited"; retryAfter: number };

/** Načte náhled cílové stránky (server, omezený počet za hodinu a svatbu); selhání nic neblokuje. */
export async function refreshGalleryCard(
  session: AdminIdentity,
  rawUrl: string,
): Promise<GalleryCardResult> {
  const url = normalizeHttpsUrl(rawUrl);
  if (!url) return { status: "invalid_url" };
  const retry = await limited(
    "gallery-card-wedding",
    session.weddingId,
    RATE_RULES.galleryCardWedding,
  );
  if (retry !== null) return { status: "limited", retryAfter: retry };
  const result = await fetchOgCard(url);
  if (!result.ok) return { status: "failed", reason: result.reason, card: result.card };
  return { status: "ok", card: await withCardImage(session, result.card) };
}

/**
 * Obrázek karty zkopírujeme do vlastního úložiště (M7c): server ho stáhne se stejnými zárukami proti SSRF jako
 * kartu, jen typ obrázku se stropem velikosti, a překóduje ho přes `sharp` jako každou fotografii. Host pak nikdy
 * nenačítá cizí obrázek. Bez nastaveného úložiště, při chybě stahování nebo zpracování zůstane karta bez obrázku
 * (dnešní chování); nic z toho uložení odkazu neblokuje.
 */
async function withCardImage(session: AdminIdentity, card: GalleryCard): Promise<GalleryCard> {
  const withoutImage = { ...card, imageMediaId: null };
  if (!card.imageUrl) return withoutImage;
  const image = await fetchOgImage(card.imageUrl);
  if (!image.ok) return withoutImage;
  const imageMediaId = await storeCardImage(session, image);
  if (!imageMediaId) return withoutImage;
  await pruneCardImages(session);
  return { ...card, imageMediaId };
}

// --- výběr svatby ----------------------------------------------------------------------------------

export async function listMyWeddings(session: AdminIdentity): Promise<MyWedding[]> {
  return adminMyWeddings(session);
}
