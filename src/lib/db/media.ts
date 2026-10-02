import "server-only";
import { z } from "zod";
import { ANONYMOUS_SUB } from "./types";
import { tenantRpc } from "./rpc";
import type { TenantIdentity } from "./transport";
import type { AdminIdentity } from "./admin-site";

/**
 * Tenký typovaný obal funkcí databáze pro fotografie (M7c, `supabase/migrations/20261008120000_media.sql`).
 * Funkce správce běží s claimy správce jedné svatby (svatba je jen z relace, nikdy z argumentu); doručení
 * (`get_public_media`) běží s claimy návštěvníka nebo hosta po PINu. Odpovědi se ověřují schématy.
 */

function admin(session: AdminIdentity): TenantIdentity {
  return { weddingId: session.weddingId, weddingRole: "admin", subject: session.subjectId };
}

export function adminMediaList(session: AdminIdentity): Promise<unknown> {
  return tenantRpc<unknown>(admin(session), "admin_media_list");
}

export function adminMediaGet(session: AdminIdentity, mediaId: string): Promise<unknown> {
  return tenantRpc<unknown>(admin(session), "admin_media_get", { p_media_id: mediaId });
}

const requestSchema = z.object({ id: z.guid(), stale: z.array(z.guid()) });

export async function adminMediaRequest(
  session: AdminIdentity,
  input: { kind: "photo" | "card"; mime: string; bytes: number },
): Promise<{ id: string; stale: string[] }> {
  const raw = await tenantRpc<unknown>(admin(session), "admin_media_request", {
    p_kind: input.kind,
    p_mime: input.mime,
    p_bytes: input.bytes,
  });
  return requestSchema.parse(raw);
}

const beginSchema = z.object({
  id: z.guid(),
  kind: z.enum(["photo", "card"]),
  mime: z.string(),
  bytes: z.coerce.number(),
});

export async function adminMediaBegin(
  session: AdminIdentity,
  mediaId: string,
): Promise<z.infer<typeof beginSchema>> {
  return beginSchema.parse(
    await tenantRpc<unknown>(admin(session), "admin_media_begin", { p_media_id: mediaId }),
  );
}

export type VariantInput = {
  width: number;
  height: number;
  format: "avif" | "webp";
  bytes: number;
  key: string;
};

export function adminMediaComplete(
  session: AdminIdentity,
  input: { mediaId: string; width: number; height: number; variants: VariantInput[] },
): Promise<unknown> {
  return tenantRpc<unknown>(admin(session), "admin_media_complete", {
    p_media_id: input.mediaId,
    p_width: input.width,
    p_height: input.height,
    // pole se v `pg` jinak převede na pole PostgreSQL, ne na JSON
    p_variants: JSON.stringify(input.variants),
  });
}

export async function adminMediaFail(
  session: AdminIdentity,
  mediaId: string,
  code: string,
): Promise<void> {
  await tenantRpc(admin(session), "admin_media_fail", { p_media_id: mediaId, p_code: code });
}

export function adminMediaUpdate(
  session: AdminIdentity,
  mediaId: string,
  input: { alt: Record<string, string> | null; decorative: boolean },
): Promise<unknown> {
  return tenantRpc<unknown>(admin(session), "admin_media_update", {
    p_media_id: mediaId,
    p_alt: input.alt,
    p_decorative: input.decorative,
  });
}

export async function adminMediaDelete(session: AdminIdentity, mediaId: string): Promise<void> {
  await tenantRpc(admin(session), "admin_media_delete", { p_media_id: mediaId });
}

const exportSchema = z.array(
  z.object({
    media_id: z.guid(),
    width: z.number().int(),
    height: z.number().int(),
    format: z.enum(["avif", "webp"]),
    bytes: z.coerce.number(),
    key: z.string(),
  }),
);

export async function adminMediaExport(session: AdminIdentity) {
  return exportSchema.parse(await tenantRpc<unknown>(admin(session), "admin_media_export"));
}

/** Klíč varianty pro náhled v rozhraní správy (i nezveřejněné fotografie vlastní svatby), nebo `null`. */
export async function adminMediaVariant(
  session: AdminIdentity,
  input: { mediaId: string; width: number; format: "avif" | "webp" },
): Promise<string | null> {
  const key = await tenantRpc<string | null>(admin(session), "admin_media_variant", {
    p_media_id: input.mediaId,
    p_width: input.width,
    p_format: input.format,
  });
  return typeof key === "string" ? key : null;
}

/** Návštěvník webu (bez PINu): jen veřejné fotografie zveřejněného snímku. */
export function visitorIdentity(weddingId: string): TenantIdentity {
  return { weddingId, weddingRole: "visitor", subject: ANONYMOUS_SUB };
}

const publicMediaSchema = z.array(z.object({ storage_key: z.string(), bytes: z.coerce.number() }));

/**
 * Klíč varianty pro doručení na webu páru. S identitou návštěvníka vrací jen veřejné fotografie, s identitou hosta
 * po PINu i ty chráněné PINem. Prázdný výsledek = 404 (neznámé, nezveřejněné, smazané i cizí médium).
 */
export async function getPublicMedia(
  identity: TenantIdentity,
  input: { mediaId: string; width: number; format: "avif" | "webp" },
): Promise<{ key: string; bytes: number } | null> {
  const rows = publicMediaSchema.parse(
    await tenantRpc<unknown>(
      identity,
      "get_public_media",
      { p_media_id: input.mediaId, p_width: input.width, p_format: input.format },
      "table",
    ),
  );
  return rows[0] ? { key: rows[0].storage_key, bytes: rows[0].bytes } : null;
}

/** Hotová média svatby (web podle nich vyřadí fotografie, které pár mezitím smazal). */
export async function publicMediaIds(identity: TenantIdentity): Promise<string[]> {
  const raw = await tenantRpc<unknown>(identity, "public_media_ids");
  return z.array(z.guid()).parse(raw ?? []);
}
