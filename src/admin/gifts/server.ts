import "server-only";
import { z } from "zod";
import type { AdminSession } from "@/auth/session";
import { RATE_RULES } from "@/auth/config";
import { READ_ONLY, tenantRpc } from "@/lib/db/rpc";
import { DbError, type TenantIdentity } from "@/lib/db/transport";
import { limited } from "@/lib/rate-guard";
import { cleanText } from "@/admin/site/doc";
import { i18nTextSchema } from "@/site/i18n-text";
import { giftInputSchema, type GiftItem } from "./types";

/**
 * Seznam věcných darů ve správě (fáze 2): přidání, úprava, pořadí, smazání a uvolnění rezervace.
 * Hosté dary rezervují na webu svatby (`src/site/gifts.ts`).
 */

type AdminIdentity = Pick<AdminSession, "weddingId" | "subjectId">;

function identity(session: AdminIdentity): TenantIdentity {
  return { weddingId: session.weddingId, weddingRole: "admin", subject: session.subjectId };
}

const i18n = i18nTextSchema;
const listSchema = z.array(
  z.object({
    id: z.string(),
    title: i18n,
    description: i18n.nullable(),
    url: z.string().nullable(),
    price: z.string().nullable(),
    reserved_at: z.string().nullable(),
    reserved_by: z.string().nullable(),
  }),
);

export async function listGifts(session: AdminIdentity): Promise<GiftItem[]> {
  const rows = listSchema.parse(
    await tenantRpc<unknown>(identity(session), "admin_gifts_list", {}, "scalar", READ_ONLY),
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    url: row.url,
    price: row.price,
    reservedAt: row.reserved_at,
    reservedBy: row.reserved_by,
  }));
}

export type GiftActionResult =
  | { status: "ok"; items: GiftItem[] }
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "limit" }
  | { status: "limited"; retryAfter: number };

async function run(
  session: AdminIdentity,
  call: () => Promise<unknown>,
): Promise<GiftActionResult> {
  const retry = await limited("gifts-write", session.weddingId, RATE_RULES.guestsWriteWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    await call();
  } catch (error) {
    if (error instanceof DbError) {
      if (error.reason === "invalid_payload") return { status: "invalid" };
      if (error.reason === "gift_not_found") return { status: "not_found" };
      if (error.reason === "gift_limit_exceeded") return { status: "limit" };
    }
    throw error;
  }
  return { status: "ok", items: await listGifts(session) };
}

export async function saveGift(
  session: AdminIdentity,
  id: string | null,
  input: unknown,
): Promise<GiftActionResult> {
  const parsed = giftInputSchema.safeParse(input);
  const uuid = z.uuid().nullable().safeParse(id);
  if (!parsed.success || !uuid.success) return { status: "invalid" };
  const title = cleanText(parsed.data.title);
  if (!title) return { status: "invalid" };
  return run(session, () =>
    tenantRpc(identity(session), "admin_gift_save", {
      p_id: uuid.data,
      p_payload: {
        title,
        description: cleanText(parsed.data.description),
        url: parsed.data.url?.trim() || null,
        price: parsed.data.price?.trim() || null,
      },
    }),
  );
}

export type GiftCommand = "delete" | "release" | "up" | "down";

export async function giftCommand(
  session: AdminIdentity,
  id: unknown,
  command: GiftCommand,
): Promise<GiftActionResult> {
  const uuid = z.uuid().safeParse(id);
  if (!uuid.success) return { status: "invalid" };
  const args = { p_id: uuid.data };
  return run(session, () =>
    command === "delete"
      ? tenantRpc(identity(session), "admin_gift_delete", args)
      : command === "release"
        ? tenantRpc(identity(session), "admin_gift_release", args)
        : tenantRpc(identity(session), "admin_gift_move", {
            ...args,
            p_delta: command === "up" ? -1 : 1,
          }),
  );
}
