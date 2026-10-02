import "server-only";
import {
  archiveDue,
  claimNotices,
  enqueueNotices,
  finishNotice,
  noticeRecipients,
  noticesPending,
} from "@/lib/lifecycle/rpc";
import { createNoticeContext, deliverNotice, type NoticeContext } from "@/lib/lifecycle/notices";
import { cronLog, errorCode } from "../log";
import type { JobContext, JobDefinition } from "../run";
import { createStepRunner, type StepRunner } from "../steps";

/** Nejvýše tolik dávek upozornění za jeden běh (pojistka proti nekonečné smyčce). */
const MAX_NOTICE_ROUNDS = 20;
const NOTICE_BATCH = 25;
/** Rezerva času na dokončení běhu (zápis výsledku). */
const RESERVE_MS = 3_000;

/**
 * Životní cyklus (FR-LC-1, FR-LC-2): archivace webů po konci provozu (published -> archived, doplnění
 * retenčních dat), plánování upozornění a odeslání upozornění a zpráv o smazání správcům. Fáze webu se
 * nezapisují: odvozují se z dat (`se_vezmou.phase`), cron mění jen uložený stav.
 */
export const lifecycleJob: JobDefinition = {
  name: "lifecycle",
  async run(context) {
    const runner = createStepRunner("lifecycle");
    const scope = { now: context.now, weddingId: context.weddingId, dryRun: context.dryRun };

    runner.counts.archived =
      (await runner.step("archive", () => archiveDue({ ...scope, batch: context.batch }))) ?? 0;

    const planned = await runner.step("plan_notices", () => enqueueNotices(scope));
    runner.counts.notices_planned_first = planned?.first ?? 0;
    runner.counts.notices_planned_final = planned?.final ?? 0;

    if (context.dryRun) {
      runner.counts.notices_pending =
        (await runner.step("count_notices", () => noticesPending(scope))) ?? 0;
    } else {
      await runner.step("send_notices", () =>
        sendPendingNotices(context, runner, createNoticeContext()),
      );
    }
    return runner.result();
  },
};

/** Odešle čekající upozornění po dávkách; vrací počet zpracovaných. Vyhozená chyba = selhání kroku. */
export async function sendPendingNotices(
  context: Pick<JobContext, "now" | "weddingId" | "timeLeftMs">,
  runner: StepRunner,
  noticeContext: NoticeContext,
): Promise<number> {
  const counts = runner.counts;
  counts.notices_sent = 0;
  counts.notices_skipped = 0;
  counts.notices_failed = 0;
  counts.messages_sent = 0;
  counts.messages_failed = 0;

  let processed = 0;
  for (let round = 0; round < MAX_NOTICE_ROUNDS; round += 1) {
    if (context.timeLeftMs() < RESERVE_MS) {
      runner.deferred();
      break;
    }
    const batch = await claimNotices({
      now: context.now,
      weddingId: context.weddingId,
      limit: NOTICE_BATCH,
    });
    if (batch.length === 0) break;

    for (const notice of batch) {
      try {
        const recipients = await noticeRecipients(notice.wedding_id);
        const delivery =
          recipients.length > 0
            ? await deliverNotice(notice, recipients, noticeContext, context.now)
            : { sent: 0, failed: 0 };
        const status = await finishNotice(notice.notice_id, delivery.sent, delivery.failed);
        if (status === "sent") counts.notices_sent += 1;
        else if (status === "skipped") counts.notices_skipped += 1;
        else {
          counts.notices_failed += 1;
          runner.problem("notice_not_delivered");
        }
        counts.messages_sent += delivery.sent;
        counts.messages_failed += delivery.failed;
        processed += 1;
      } catch (error) {
        // upozornění zůstane ve stavu sending a po 15 minutách se převezme znovu
        runner.problem("notice_error");
        cronLog("error", "cron_notice_failed", {
          job: "lifecycle",
          kind: notice.kind,
          stage: notice.stage,
          error_code: errorCode(error),
        });
      }
    }
  }
  return processed;
}
