import "server-only";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/env";
import { jobRunFinish, jobRunStart } from "@/lib/lifecycle/rpc";
import { createCronHandler, BUDGET_MS, type CronHandlerOptions } from "./handler";

/** Obsluhovač s ostrými závislostmi: prostředí, zápis běhů do databáze a hlášení selhání do Sentry. */
export function defaultCronHandler(options: CronHandlerOptions) {
  return createCronHandler(options, {
    environment: () => ({
      secret: env.CRON_SECRET,
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
