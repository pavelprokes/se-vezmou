import "server-only";
import { z } from "zod";
import type { AdminSession } from "@/auth/session";
import { RATE_RULES } from "@/auth/config";
import { READ_ONLY, tenantRpc } from "@/lib/db/rpc";
import { DbError, type TenantIdentity } from "@/lib/db/transport";
import { limited } from "@/lib/rate-guard";
import {
  NOTES_MAX,
  vendorCategories,
  vendorInputSchema,
  vendorStatuses,
  type Vendor,
} from "./types";

/** Soukromé poznámky a dodavatelé ve správě: jen přes funkce `admin_vendor*` a `admin_notes_*`. */

type AdminIdentity = Pick<AdminSession, "weddingId" | "subjectId">;

function identity(session: AdminIdentity): TenantIdentity {
  return { weddingId: session.weddingId, weddingRole: "admin", subject: session.subjectId };
}

const vendorsSchema = z.array(
  z.object({
    id: z.string(),
    category: z.enum(vendorCategories),
    name: z.string(),
    contact: z.string().nullable(),
    url: z.string().nullable(),
    price: z.string().nullable(),
    status: z.enum(vendorStatuses),
    note: z.string().nullable(),
  }),
);

export async function listVendors(session: AdminIdentity): Promise<Vendor[]> {
  return vendorsSchema.parse(
    await tenantRpc<unknown>(identity(session), "admin_vendors_list", {}, "scalar", READ_ONLY),
  );
}

const notesSchema = z.object({ body: z.string(), rev: z.number().int() });

export async function loadNotes(session: AdminIdentity): Promise<{ body: string; rev: number }> {
  return notesSchema.parse(
    await tenantRpc<unknown>(identity(session), "admin_notes_get", {}, "scalar", READ_ONLY),
  );
}

export type VendorActionResult =
  | { status: "ok"; vendors: Vendor[] }
  | { status: "invalid" }
  | { status: "not_found" }
  | { status: "limit" }
  | { status: "limited"; retryAfter: number };

async function vendorCall(
  session: AdminIdentity,
  call: () => Promise<unknown>,
): Promise<VendorActionResult> {
  const retry = await limited("notes-write", session.weddingId, RATE_RULES.guestsWriteWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    await call();
  } catch (error) {
    if (error instanceof DbError) {
      if (error.reason === "invalid_payload") return { status: "invalid" };
      if (error.reason === "vendor_not_found") return { status: "not_found" };
      if (error.reason === "vendor_limit_exceeded") return { status: "limit" };
    }
    throw error;
  }
  return { status: "ok", vendors: await listVendors(session) };
}

export async function saveVendor(
  session: AdminIdentity,
  id: string | null,
  input: unknown,
): Promise<VendorActionResult> {
  const parsed = vendorInputSchema.safeParse(input);
  const uuid = z.uuid().nullable().safeParse(id);
  if (!parsed.success || !uuid.success) return { status: "invalid" };
  const empty = (value: string | null) => (value && value.trim() !== "" ? value.trim() : null);
  return vendorCall(session, () =>
    tenantRpc(identity(session), "admin_vendor_save", {
      p_id: uuid.data,
      p_payload: {
        ...parsed.data,
        contact: empty(parsed.data.contact),
        url: empty(parsed.data.url),
        price: empty(parsed.data.price),
        note: empty(parsed.data.note),
      },
    }),
  );
}

export async function deleteVendor(
  session: AdminIdentity,
  id: unknown,
): Promise<VendorActionResult> {
  const uuid = z.uuid().safeParse(id);
  if (!uuid.success) return { status: "invalid" };
  return vendorCall(session, () =>
    tenantRpc(identity(session), "admin_vendor_delete", { p_id: uuid.data }),
  );
}

export type NotesResult =
  | { status: "saved"; rev: number }
  | { status: "conflict" }
  | { status: "invalid" }
  | { status: "limited"; retryAfter: number };

export async function saveNotes(session: AdminIdentity, input: unknown): Promise<NotesResult> {
  const parsed = z
    .object({ body: z.string().max(NOTES_MAX), rev: z.number().int().min(0) })
    .safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const retry = await limited("notes-write", session.weddingId, RATE_RULES.guestsWriteWedding);
  if (retry !== null) return { status: "limited", retryAfter: retry };
  try {
    const rev = await tenantRpc<number>(identity(session), "admin_notes_save", {
      p_body: parsed.data.body,
      p_rev: parsed.data.rev,
    });
    return { status: "saved", rev };
  } catch (error) {
    if (error instanceof DbError && error.reason === "conflict") return { status: "conflict" };
    throw error;
  }
}
