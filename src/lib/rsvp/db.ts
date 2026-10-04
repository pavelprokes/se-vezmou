import "server-only";
import { z } from "zod";
import { READ_ONLY, tenantRpc } from "@/lib/db/rpc";
import { DbError, type TenantIdentity } from "@/lib/db/transport";
import {
  rsvpInfoSchema,
  rsvpViewSchema,
  unlistedFormSchema,
  type RsvpInfo,
  type RsvpView,
  type SubmitPayload,
  type UnlistedFormView,
} from "./types";

/**
 * Volání databázových funkcí RSVP z pohledu hosta (role `visitor`; host po PINu má stejná práva).
 * Odpovědi se ověřují zod schématy; neplatný tvar je chyba nasazení (nesoulad aplikace a databáze),
 * ne vstup uživatele. Žádná chyba nenese argumenty volání (jména, e-maily).
 */

export function visitor(weddingId: string): TenantIdentity {
  return { weddingId, weddingRole: "visitor" };
}

/** Otevřenost RSVP a volby páru; `null` pro neveřejný web. */
export async function fetchRsvpInfo(weddingId: string): Promise<RsvpInfo | null> {
  const raw = await tenantRpc<unknown>(visitor(weddingId), "rsvp_info", {}, "scalar", READ_ONLY);
  return raw === null ? null : rsvpInfoSchema.parse(raw);
}

/**
 * Slepé porovnání jména. Vrací lístek, nebo `null`; žádná shoda, více shod, zavřené RSVP i chybná
 * role dávají stejný výsledek, takže volající nemůže nic prozradit.
 */
export async function matchName(weddingId: string, name: string): Promise<string | null> {
  const rows = await tenantRpc<{ ticket: string | null }[]>(
    visitor(weddingId),
    "rsvp_match",
    { p_name: name },
    "table",
  );
  return rows[0]?.ticket ?? null;
}

const inviteInfoSchema = z.object({
  locale: z.string().nullable(),
  event_ids: z.array(z.string()),
  /** Události s potvrzováním podle databáze (ne podle zveřejněného snímku). */
  rsvp_event_ids: z.array(z.string()).default([]),
});
export type InviteInfo = z.infer<typeof inviteInfoSchema>;

/** Osobní odkaz domácnosti: jazyk hosta a události, na které je pozvaná; `null` pro neplatný kód. */
export async function fetchInviteInfo(weddingId: string, code: string): Promise<InviteInfo | null> {
  const raw = await tenantRpc<unknown>(
    visitor(weddingId),
    "rsvp_invite_info",
    { p_code: code },
    "scalar",
    READ_ONLY,
  );
  return raw === null ? null : inviteInfoSchema.parse(raw);
}

/** Formulář domácnosti z kódu osobního odkazu pro vykreslení (jen čtení); `null` mimo otevřené RSVP. */
export async function fetchInviteView(weddingId: string, code: string): Promise<RsvpView | null> {
  const raw = await tenantRpc<unknown>(
    visitor(weddingId),
    "rsvp_invite_get",
    { p_code: code },
    "scalar",
    READ_ONLY,
  );
  return raw === null ? null : rsvpViewSchema.parse(raw);
}

/** Lístek RSVP z kódu osobního odkazu (zapisuje, jen při odeslání); `null` mimo otevřené RSVP. */
export async function inviteTicket(weddingId: string, code: string): Promise<string | null> {
  return tenantRpc<string | null>(visitor(weddingId), "rsvp_invite_ticket", { p_code: code });
}

/** Domácnost a dřívější odpověď podle lístku; `null` pro neplatný nebo prošlý lístek. */
export async function fetchHouseholdView(
  weddingId: string,
  ticket: string,
): Promise<RsvpView | null> {
  const raw = await tenantRpc<unknown>(
    visitor(weddingId),
    "rsvp_get",
    { p_ticket: ticket },
    "scalar",
    READ_ONLY,
  );
  return raw === null ? null : rsvpViewSchema.parse(raw);
}

/** Formulář hosta mimo seznam; `null`, když to pár nepovolil nebo je RSVP zavřené. */
export async function fetchUnlistedForm(weddingId: string): Promise<UnlistedFormView | null> {
  const raw = await tenantRpc<unknown>(
    visitor(weddingId),
    "rsvp_unlisted_form",
    {},
    "scalar",
    READ_ONLY,
  );
  return raw === null ? null : unlistedFormSchema.parse(raw);
}

/** Důvody, proč databáze odpověď odmítla (podle identifikátoru hlášení funkce). */
export type SubmitFailure = "ticket" | "closed" | "unlisted" | "invalid";

/** `duplicate`: odpověď se stejným nonce už je uložená (dvojklik, opakování); nic se nezapsalo podruhé. */
/**
 * `keptEmail`: host nechal pole e-mailu prázdné a databáze ponechala dřívější adresu; vrací se jen serveru
 * kvůli potvrzení e-mailem, do stavu formuláře ani prohlížeče se nikdy nedostane.
 */
export type SubmitOutcome =
  { ok: true; duplicate: boolean; keptEmail?: string } | { ok: false; reason: SubmitFailure };

/** Hlášení funkcí, která znamenají neplatný obsah odpovědi (ne chybu aplikace ani databáze). */
export const INVALID_REASONS: ReadonlySet<string> = new Set([
  "invalid_payload",
  "invalid_guest",
  "event_not_invited",
  "plus_one_not_allowed",
  "children_not_allowed",
  "too_many_plus_one",
  "answer_required",
]);

function classify(error: unknown): SubmitFailure {
  if (error instanceof DbError) {
    if (error.reason === "invalid_ticket") return "ticket";
    if (error.reason === "rsvp_closed") return "closed";
    if (error.reason === "unlisted_not_allowed") return "unlisted";
    if (error.reason && INVALID_REASONS.has(error.reason)) return "invalid";
  }
  // Cokoli jiného (spojení, oprávnění, nesoulad schématu) je chyba, ne odpověď hosta.
  throw error;
}

async function submit(call: () => Promise<unknown>): Promise<SubmitOutcome> {
  try {
    const result = await call();
    const record =
      typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {};
    const keptEmail = typeof record.kept_email === "string" ? record.kept_email : undefined;
    return { ok: true, duplicate: record.duplicate === true, ...(keptEmail ? { keptEmail } : {}) };
  } catch (error) {
    return { ok: false, reason: classify(error) };
  }
}

export function submitHousehold(
  weddingId: string,
  ticket: string,
  payload: SubmitPayload,
): Promise<SubmitOutcome> {
  return submit(() =>
    tenantRpc(visitor(weddingId), "rsvp_submit", { p_ticket: ticket, p_payload: payload }),
  );
}

export function submitUnlisted(weddingId: string, payload: SubmitPayload): Promise<SubmitOutcome> {
  return submit(() =>
    tenantRpc(visitor(weddingId), "rsvp_submit_unlisted", { p_payload: payload }),
  );
}
