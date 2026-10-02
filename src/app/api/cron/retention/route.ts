import { defaultCronHandler } from "@/lib/cron/default";
import { retentionJob } from "@/lib/cron/jobs/retention";

/**
 * Retence a nevratné mazání: zdravotní údaje, údaje hostů, trvalé smazání webů po ochranné lhůtě (nejdřív soubory
 * v úložišti). Autorizace `Authorization: Bearer ${CRON_SECRET}`, proxy cestu vynechává.
 * Parametry: `dry_run`, `batch`, `wedding_id`; `now` jen v testech (CRON_TEST_CLOCK).
 */
export const maxDuration = 60;

const handler = defaultCronHandler({ jobs: [retentionJob], allowTestClock: true });

export const GET = handler;
export const POST = handler;
