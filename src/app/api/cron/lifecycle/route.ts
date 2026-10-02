import { defaultCronHandler } from "@/lib/cron/default";
import { lifecycleJob } from "@/lib/cron/jobs/lifecycle";

/**
 * Životní cyklus: archivace webů po konci provozu a upozornění správcům před vypršením a smazáním.
 * Autorizace `Authorization: Bearer ${CRON_SECRET}` (src/lib/cron/handler.ts), proxy cestu vynechává.
 * Parametry: `dry_run`, `batch`, `wedding_id`; `now` jen v testech (CRON_TEST_CLOCK).
 */
export const maxDuration = 60;

const handler = defaultCronHandler({ jobs: [lifecycleJob], allowTestClock: true });

export const GET = handler;
export const POST = handler;
