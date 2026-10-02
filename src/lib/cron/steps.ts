import { cronLog, errorCode } from "./log";
import type { JobOutcome, JobResult } from "./run";

/**
 * Pomocník pro úlohy složené z nezávislých kroků: selhání jednoho kroku nezastaví ostatní (další běh ho
 * zopakuje, krok je idempotentní), jen se započítá a výsledek úlohy je `partial` (část kroků prošla),
 * nebo `failed` (neprošel žádný).
 */

export type StepRunner = {
  counts: Record<string, number>;
  /** Spustí krok; vrací jeho výsledek, nebo `undefined` při selhání (chyba se zaznamená bez údajů). */
  step<T>(name: string, run: () => Promise<T>): Promise<T | undefined>;
  /** Zaznamená problém, který krok sám zvládl (např. nedoručená zpráva), a úloha bude `partial`. */
  problem(code: string): void;
  /** Úloha neprošla celá kvůli rozpočtu času nebo dávce: další běh dokončí zbytek. */
  deferred(): void;
  result(): JobResult;
};

export function createStepRunner(job: string): StepRunner {
  const counts: Record<string, number> = {};
  let succeeded = 0;
  let failedSteps = 0;
  let problems = 0;
  let isDeferred = false;
  let firstError: string | undefined;

  return {
    counts,
    async step(name, run) {
      try {
        const value = await run();
        succeeded += 1;
        return value;
      } catch (error) {
        failedSteps += 1;
        firstError ??= `${name}:${errorCode(error)}`.slice(0, 100);
        cronLog("error", "cron_step_failed", { job, step: name, error_code: errorCode(error) });
        return undefined;
      }
    },
    problem(code) {
      problems += 1;
      firstError ??= code.slice(0, 100);
    },
    deferred() {
      isDeferred = true;
    },
    result() {
      let status: JobOutcome = "ok";
      if (failedSteps > 0 && succeeded === 0) status = "failed";
      else if (failedSteps > 0 || problems > 0 || isDeferred) status = "partial";
      if (isDeferred) counts.deferred = 1;
      return { status, counts, errorCode: firstError };
    },
  };
}
