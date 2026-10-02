import { defaultCronHandler } from "@/lib/cron/default";
import { housekeepingJob } from "@/lib/cron/jobs/housekeeping";

/**
 * Denní úklid: uvolnění rezervací adres, prošlé relace, výzvy, lístky, čítače a provozní záznamy bez osobních
 * údajů. Je globální, proto neumí simulovaný čas. Autorizace `Authorization: Bearer ${CRON_SECRET}`.
 * Parametry: `dry_run`.
 */
export const maxDuration = 60;

const handler = defaultCronHandler({ jobs: [housekeepingJob], allowTestClock: false });

export const GET = handler;
export const POST = handler;
