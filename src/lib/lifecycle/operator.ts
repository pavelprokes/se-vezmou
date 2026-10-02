import "server-only";
import { serviceRpc } from "@/lib/db/rpc";
import type { WeddingPhase } from "@/lib/db/types";
import type { NoticeKind } from "./rpc";

/**
 * Data pro provozní administraci (M9): souhrn běhů plánovaných úloh, weby před vypršením a smazáním a ruční
 * přepsání fáze. Bez rozhraní (to dělá M9). Každá funkce databáze sama ověřuje operátora (`assert_operator`:
 * role owner nebo support, nezakázaný); volající (Server Action v `/h/admin`) předá `operatorId` z ověřené
 * relace operátora a nikdy ho nebere z požadavku.
 */

export type JobRunSummary = {
  job: string;
  last_started_at: string;
  last_finished_at: string | null;
  last_status: "running" | "ok" | "partial" | "failed";
  last_counts: Record<string, number>;
  last_error_code: string | null;
  last_ok_at: string | null;
  failures_7d: number;
  running: boolean;
};

export type JobRun = {
  id: string;
  job: string;
  started_at: string;
  finished_at: string | null;
  clock_at: string;
  status: "running" | "ok" | "partial" | "failed";
  counts: Record<string, number>;
  error_code: string | null;
};

export type ExpiringWedding = {
  wedding_id: string;
  slug: string | null;
  status: string;
  partner_a_name: string;
  partner_b_name: string;
  kind: NoticeKind | "site_purge";
  event_at: string;
  /** Záporné u zpožděných událostí (po termínu a ještě nezpracované). */
  days_left: number;
  overdue: boolean;
  first_notice_status: string | null;
  first_notice_sent_at: string | null;
  final_notice_status: string | null;
  final_notice_sent_at: string | null;
  phase_override: WeddingPhase | null;
};

export async function jobRunsSummary(operatorId: string): Promise<JobRunSummary[]> {
  return await serviceRpc<JobRunSummary[]>(
    "op_job_runs_summary",
    { p_operator_id: operatorId },
    "table",
  );
}

export async function recentJobRuns(
  operatorId: string,
  options: { limit?: number; job?: string } = {},
): Promise<JobRun[]> {
  return await serviceRpc<JobRun[]>(
    "op_job_runs",
    { p_operator_id: operatorId, p_limit: options.limit, p_job: options.job },
    "table",
  );
}

/** Weby, jejichž provoz nebo údaje hostů brzy vyprší (a zpožděné), s evidencí odeslaných upozornění. */
export async function expiringWeddings(
  operatorId: string,
  withinDays = 60,
): Promise<ExpiringWedding[]> {
  return await serviceRpc<ExpiringWedding[]>(
    "op_expiring_weddings",
    { p_operator_id: operatorId, p_within_days: withinDays },
    "table",
  );
}

/** Ruční přepsání fáze s povinným důvodem a auditem; `null` přepsání zruší. */
export async function setPhaseOverride(
  operatorId: string,
  weddingId: string,
  phase: WeddingPhase | null,
  reason: string,
): Promise<void> {
  await serviceRpc("op_set_phase_override", {
    p_operator_id: operatorId,
    p_wedding_id: weddingId,
    p_phase: phase,
    p_reason: reason,
  });
}
