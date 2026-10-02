import "server-only";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/env";
import { jobRunFinish, jobRunStart } from "@/lib/lifecycle/rpc";
import { cronLog } from "./log";
import { createCronHandler, BUDGET_MS, type CronHandlerOptions } from "./handler";

const MIN_SECRET_LENGTH = 32;

/** Příliš krátká tajná hodnota se bere jako nenastavená (cron vrací 401), aby neposloužila slabá hodnota. */
function usableSecret(secret: string | undefined): string | undefined {
  if (secret !== undefined && secret.length < MIN_SECRET_LENGTH) {
    cronLog("error", "cron_secret_too_short", { min_length: MIN_SECRET_LENGTH });
    return undefined;
  }
  return secret;
}

/** Obsluhovač s ostrými závislostmi: prostředí, zápis běhů do databáze a hlášení selhání do Sentry. */
export function defaultCronHandler(options: CronHandlerOptions) {
  return createCronHandler(options, {
    environment: () => ({
      secret: usableSecret(env.CRON_SECRET),
      testClock: env.CRON_TEST_CLOCK === "1",
      production: process.env.VERCEL_ENV === "production",
    }),
    store: () => ({
      start: (job, now) => jobRunStart(job, now),
      finish: (id, status, counts, errorCode) => jobRunFinish(id, status, counts, errorCode),
    }),
    reportFailure(job, code) {
      // jen název úlohy a kód chyby: do monitoringu nejdou žádné údaje z databáze
      try {
        Sentry.captureException(new Error(`Plánovaná úloha ${job} selhala (${code})`));
      } catch {
        // monitoring nesmí shodit úlohu
      }
    },
    budgetMs: BUDGET_MS,
  });
}
