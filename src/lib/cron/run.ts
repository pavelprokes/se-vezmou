import { cronLog, errorCode } from "./log";

/**
 * Běh jedné plánované úlohy: zapůjčení zámku proti souběhu, měření času, výsledek do `job_runs`
 * (a z databáze do auditu, vše bez osobních údajů) a strukturovaný log. Úlohy jsou idempotentní, berou
 * dávky a hlídají časový rozpočet; co se nestihne, dokončí další běh.
 */

export type JobName = "lifecycle" | "retention" | "housekeeping";
export type JobOutcome = "ok" | "partial" | "failed";

export type JobContext = {
  /** Čas, ke kterému úloha počítá (skutečný, nebo v testech simulovaný). */
  now: Date;
  dryRun: boolean;
  batch: number;
  weddingId: string | null;
  /** Zbývající rozpočet v milisekundách; úloha ho kontroluje mezi dávkami. */
  timeLeftMs: () => number;
};

export type JobResult = {
  status: JobOutcome;
  /** Jen počty podle druhů práce. */
  counts: Record<string, number>;
  errorCode?: string;
};

export type JobDefinition = {
  name: JobName;
  run(context: JobContext): Promise<JobResult>;
};

export type JobReport = {
  job: JobName;
  /** `skipped`: téže úloze už běh probíhá (zámek); `dry_run`: nic se nezapsalo. */
  status: JobOutcome | "skipped" | "dry_run";
  counts: Record<string, number>;
  errorCode?: string;
  durationMs: number;
};

/** Zámek běhu a záznam výsledku; v testech nahraditelné. */
export type JobRunStore = {
  start(job: JobName, now: Date): Promise<string | null>;
  finish(
    id: string,
    status: JobOutcome,
    counts: Record<string, number>,
    errorCode?: string,
  ): Promise<void>;
};

export async function runJob(
  job: JobDefinition,
  context: JobContext,
  store: JobRunStore,
): Promise<JobReport> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const base = { job: job.name, dry_run: context.dryRun, batch: context.batch };

  // dry_run nic nezapisuje, tedy ani běh: spočítá a vrátí počty
  if (context.dryRun) {
    try {
      const result = await job.run(context);
      cronLog("info", "cron_dry_run", { ...base, status: result.status, ...result.counts });
      return {
        job: job.name,
        status: "dry_run",
        counts: result.counts,
        errorCode: result.errorCode,
        durationMs: elapsed(),
      };
    } catch (error) {
      const code = errorCode(error);
      cronLog("error", "cron_dry_run_failed", { ...base, error_code: code });
      return {
        job: job.name,
        status: "failed",
        counts: {},
        errorCode: code,
        durationMs: elapsed(),
      };
    }
  }

  let runId: string | null;
  try {
    runId = await store.start(job.name, context.now);
  } catch (error) {
    const code = errorCode(error);
    cronLog("error", "cron_start_failed", { ...base, error_code: code });
    return { job: job.name, status: "failed", counts: {}, errorCode: code, durationMs: elapsed() };
  }
  if (runId === null) {
    cronLog("warn", "cron_skipped_locked", base);
    return { job: job.name, status: "skipped", counts: {}, durationMs: elapsed() };
  }

  let result: JobResult;
  try {
    result = await job.run(context);
  } catch (error) {
    result = { status: "failed", counts: {}, errorCode: errorCode(error) };
  }

  try {
    await store.finish(runId, result.status, result.counts, result.errorCode);
  } catch (error) {
    // výsledek se nepodařilo zapsat: zapůjčení vyprší samo, běh se označí jako failed při dalším startu
    cronLog("error", "cron_finish_failed", { ...base, error_code: errorCode(error) });
  }

  cronLog(
    result.status === "failed" ? "error" : result.status === "partial" ? "warn" : "info",
    "cron_finished",
    {
      ...base,
      status: result.status,
      error_code: result.errorCode,
      duration_ms: elapsed(),
      ...result.counts,
    },
  );
  return {
    job: job.name,
    status: result.status,
    counts: result.counts,
    errorCode: result.errorCode,
    durationMs: elapsed(),
  };
}
