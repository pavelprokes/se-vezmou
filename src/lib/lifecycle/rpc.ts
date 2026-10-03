import "server-only";
import { serviceRpc } from "@/lib/db/rpc";

/**
 * Tenký typovaný obal funkcí databáze pro plánované úlohy (M10): životní cyklus, retence a úklid.
 * Všechny běží jako service role (cron). Jedna funkce SQL = jedna funkce zde; názvy argumentů
 * odpovídají `supabase/migrations/2026100512*.sql`. „Teď“ (`now`) předává jen úloha: v produkci je to
 * skutečný čas, v testech simulovaný (`src/lib/cron/params.ts`). `dryRun` provede práci a vrátí ji zpět.
 */

export type Scope = {
  now: Date;
  weddingId?: string | null;
  dryRun?: boolean;
};

const iso = (date: Date) => date.toISOString();

// --- běhy úloh --------------------------------------------------------------------------

export type JobStatus = "ok" | "partial" | "failed";

/** Zapůjčení zámku úlohy; `null`, když téže úloze už běh probíhá. */
export function jobRunStart(job: string, now: Date): Promise<string | null> {
  return serviceRpc<string | null>("job_run_start", { p_job: job, p_now: iso(now) });
}

export async function jobRunFinish(
  id: string,
  status: JobStatus,
  counts: Record<string, number>,
  errorCode?: string,
): Promise<void> {
  await serviceRpc("job_run_finish", {
    p_id: id,
    p_status: status,
    p_counts: counts,
    p_error_code: errorCode,
  });
}

// --- životní cyklus a upozornění --------------------------------------------------------

export function archiveDue(scope: Scope & { batch: number }): Promise<number> {
  return serviceRpc<number>("lifecycle_archive_due", {
    p_now: iso(scope.now),
    p_batch: scope.batch,
    p_wedding_id: scope.weddingId ?? null,
    p_dry_run: scope.dryRun ?? false,
  });
}

/** Archivované weby po lhůtě za `guest_purge_at` přejdou do stavu deleted (ochranná lhůta, potom retence). */
export function deleteArchived(scope: Scope & { batch: number }): Promise<number> {
  return serviceRpc<number>("lifecycle_delete_archived", {
    p_now: iso(scope.now),
    p_batch: scope.batch,
    p_wedding_id: scope.weddingId ?? null,
    p_dry_run: scope.dryRun ?? false,
  });
}

export function enqueueNotices(scope: Scope): Promise<{ first: number; final: number }> {
  return serviceRpc<{ first: number; final: number }>("lifecycle_enqueue_notices", {
    p_now: iso(scope.now),
    p_wedding_id: scope.weddingId ?? null,
    p_dry_run: scope.dryRun ?? false,
  });
}

export function noticesPending(scope: Scope): Promise<number> {
  return serviceRpc<number>("lifecycle_notices_pending", {
    p_now: iso(scope.now),
    p_wedding_id: scope.weddingId ?? null,
  });
}

export type NoticeKind = "site_expiry" | "health_purge" | "guest_purge";
export type NoticeStage = "first" | "final" | "done";

export type ClaimedNotice = {
  notice_id: string;
  wedding_id: string;
  kind: NoticeKind;
  stage: NoticeStage;
  event_at: string;
  slug: string | null;
  locale: "cs" | "en";
  timezone: string;
  attempt: number;
};

export async function claimNotices(scope: Scope & { limit: number }): Promise<ClaimedNotice[]> {
  return (await serviceRpc<ClaimedNotice[]>(
    "lifecycle_notices_claim",
    {
      p_now: iso(scope.now),
      p_limit: scope.limit,
      p_wedding_id: scope.weddingId ?? null,
    },
    "table",
  )) as ClaimedNotice[];
}

export type Recipient = { email: string; locale: "cs" | "en" };

/** Adresy aktivních správců: jdou jen k odeslání, nikam se neukládají ani nelogují. */
export async function noticeRecipients(weddingId: string): Promise<Recipient[]> {
  return await serviceRpc<Recipient[]>(
    "lifecycle_notice_recipients",
    { p_wedding_id: weddingId },
    "table",
  );
}

export function finishNotice(id: string, sent: number, failed: number): Promise<string> {
  return serviceRpc<string>("lifecycle_notice_finish", {
    p_id: id,
    p_sent: sent,
    p_failed: failed,
  });
}

// --- retence ----------------------------------------------------------------------------

export function purgeHealthData(scope: Scope & { batch: number }): Promise<number> {
  return serviceRpc<number>("purge_health_data", {
    p_batch: scope.batch,
    p_now: iso(scope.now),
    p_wedding_id: scope.weddingId ?? null,
    p_dry_run: scope.dryRun ?? false,
  });
}

export function purgeGuestData(scope: Scope & { batch: number }): Promise<number> {
  return serviceRpc<number>("purge_guest_data", {
    p_batch: scope.batch,
    p_now: iso(scope.now),
    p_wedding_id: scope.weddingId ?? null,
    p_dry_run: scope.dryRun ?? false,
  });
}

export type DueWedding = {
  wedding_id: string;
  purge_at: string;
  media_count: number;
  slug: string | null;
  timezone: string;
  locale: "cs" | "en";
};

export async function dueWeddings(scope: Scope & { batch: number }): Promise<DueWedding[]> {
  return await serviceRpc<DueWedding[]>(
    "retention_due_weddings",
    { p_now: iso(scope.now), p_batch: scope.batch, p_wedding_id: scope.weddingId ?? null },
    "table",
  );
}

/**
 * Čerstvá kontrola způsobilosti a převzetí webu těsně před mazáním souborů (pod zámkem řádku). `false`: web mezitím
 * obnoven, prodloužen nebo ho už maže jiný běh, soubory se nemažou. Převzetí zároveň odmítne obnovu operátorem
 * po dobu mazání (`purge_in_progress`).
 */
export function claimPurge(weddingId: string, now: Date): Promise<boolean> {
  return serviceRpc<boolean>("retention_claim", { p_wedding_id: weddingId, p_now: iso(now) });
}

/** Uvolní převzetí po selhání; další pokus přijde až po záloze (počet pokusů zůstává). */
export async function releasePurge(weddingId: string): Promise<void> {
  await serviceRpc("retention_release", { p_wedding_id: weddingId });
}

export type PurgeWeddingResult = {
  kind: "wedding";
  guests: number;
  blocks: number;
  media: number;
  storage_paths: string[];
};

export function purgeWedding(weddingId: string, now: Date): Promise<PurgeWeddingResult> {
  return serviceRpc<PurgeWeddingResult>("purge_wedding", {
    p_wedding_id: weddingId,
    p_now: iso(now),
  });
}

// --- úklid ------------------------------------------------------------------------------

export function purgeExpiredSlugReservations(scope: Scope): Promise<number> {
  return serviceRpc<number>("purge_expired_slug_reservations", {
    p_now: iso(scope.now),
    p_dry_run: scope.dryRun ?? false,
  });
}

export function housekeeping(scope: Scope): Promise<Record<string, number>> {
  return serviceRpc<Record<string, number>>("housekeeping", {
    p_now: iso(scope.now),
    p_dry_run: scope.dryRun ?? false,
  });
}
