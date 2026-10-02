import { defaultCronHandler } from "@/lib/cron/default";
import { housekeepingJob } from "@/lib/cron/jobs/housekeeping";
import { lifecycleJob } from "@/lib/cron/jobs/lifecycle";
import { retentionJob } from "@/lib/cron/jobs/retention";

/**
 * Denní běh všech úloh za sebou: retence, životní cyklus (po retenci, aby se zprávy o smazání odeslaly týž den)
 * a úklid. Tuto cestu volá Vercel Cron podle `vercel.json`: na tarifu Hobby je jen omezený počet cronů
 * a nejvýše denní frekvence, proto jeden denní cron místo tří. Jednotlivé úlohy mají vlastní cesty
 * (`/api/cron/retention`, `/lifecycle`, `/housekeeping`) pro ruční spuštění a pro tarif s více cron úlohami.
 * Všechny úlohy jsou idempotentní a mají časový rozpočet; co se nestihne, dokončí další běh.
 * Autorizace `Authorization: Bearer ${CRON_SECRET}`. Parametry: `dry_run`, `batch`, `wedding_id`.
 */
export const maxDuration = 60;

const handler = defaultCronHandler({
  jobs: [retentionJob, lifecycleJob, housekeepingJob],
  allowTestClock: false,
});

export const GET = handler;
export const POST = handler;
