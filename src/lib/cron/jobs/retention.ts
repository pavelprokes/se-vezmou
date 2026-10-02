import "server-only";
import { currentHostConfig, siteHostname } from "@/auth/app-origin";
import { requireEnv } from "@/env";
import { sendTemplatedEmail } from "@/lib/email/send";
import { renderDeletionNotice } from "@/lib/email/templates";
import {
  dueWeddings,
  noticeRecipients,
  purgeGuestData,
  purgeHealthData,
  purgeWedding,
  type DueWedding,
  type Recipient,
} from "@/lib/lifecycle/rpc";
import { getStorage } from "@/lib/storage";
import { DbError } from "@/lib/db/transport";
import { cronLog, errorCode } from "../log";
import type { JobContext, JobDefinition } from "../run";
import { createStepRunner } from "../steps";

/** Nejvýše tolik webů k trvalému smazání za jeden běh (soubory se mažou po jednom). */
const WEDDING_BATCH = 20;
const RESERVE_MS = 3_000;

/**
 * Retence a nevratné mazání (FR-OPS-5, docs/data-model.md kap. 10, docs/security-privacy.md kap. 6):
 *  1. zdravotní údaje (dieta, alergie) po `health_purge_at`, 2. ostatní údaje hostů po `guest_purge_at`
 *     (lhůty z app_settings, schvaluje právník), obojí zvlášť; zprávu o smazání odešle úloha životního cyklu,
 *  3. trvalé smazání webů po ochranné lhůtě (`purge_at`): nejdřív soubory v úložišti (předpona `{wedding_id}/`),
 *     TEPRVE POTOM řádky. Selhání mazání souborů web neoznačí za vymazaný: zůstane ve stavu deleted a další
 *     běh to zkusí znovu. Obnovení v ochranné lhůtě je jen operátorská věc (M9) a ruší `purge_at`.
 * Do auditu jde jen počet řádků a druh (bez osobních údajů).
 */
export const retentionJob: JobDefinition = {
  name: "retention",
  async run(context) {
    const runner = createStepRunner("retention");
    const scope = { now: context.now, weddingId: context.weddingId, dryRun: context.dryRun };

    runner.counts.health_rows =
      (await runner.step("purge_health", () =>
        purgeHealthData({ ...scope, batch: context.batch }),
      )) ?? 0;
    runner.counts.guest_rows =
      (await runner.step("purge_guests", () =>
        purgeGuestData({ ...scope, batch: context.batch }),
      )) ?? 0;

    const due = await runner.step("list_due_weddings", () =>
      dueWeddings({ ...scope, batch: Math.min(context.batch, WEDDING_BATCH) }),
    );
    runner.counts.weddings_due = due?.length ?? 0;
    if (due?.length === WEDDING_BATCH) runner.deferred();

    if (context.dryRun) {
      runner.counts.files_to_delete = (due ?? []).reduce((sum, w) => sum + w.media_count, 0);
      return runner.result();
    }

    runner.counts.weddings_purged = 0;
    runner.counts.weddings_restored = 0;
    runner.counts.storage_failed = 0;
    runner.counts.files_deleted = 0;
    runner.counts.messages_sent = 0;
    runner.counts.messages_failed = 0;
    for (const wedding of due ?? []) {
      if (context.timeLeftMs() < RESERVE_MS) {
        runner.deferred();
        break;
      }
      await purgeOne(wedding, context, runner);
    }
    return runner.result();
  },
};

async function purgeOne(
  wedding: DueWedding,
  context: Pick<JobContext, "now">,
  runner: ReturnType<typeof createStepRunner>,
): Promise<void> {
  const counts = runner.counts;

  // adresy správců se čtou DŘÍV, po smazání webu už neexistují; chyba čtení smazání nebrání
  let recipients: Recipient[] = [];
  try {
    recipients = await noticeRecipients(wedding.wedding_id);
  } catch (error) {
    cronLog("warn", "cron_recipients_failed", { job: "retention", error_code: errorCode(error) });
  }

  let filesDeleted = 0;
  try {
    filesDeleted = (await getStorage().deletePrefix(wedding.wedding_id)).deleted;
  } catch (error) {
    // soubory se nepodařilo smazat: řádky zůstanou, web se nemaže, další běh to zopakuje
    counts.storage_failed += 1;
    runner.problem("storage_delete_failed");
    cronLog("error", "cron_storage_delete_failed", {
      job: "retention",
      error_code: errorCode(error),
    });
    return;
  }

  try {
    await purgeWedding(wedding.wedding_id, context.now);
  } catch (error) {
    if (error instanceof DbError && error.reason === "wedding_not_purgeable") {
      // mezitím obnoven (nebo prodloužen) operátorem: nic se nemaže
      counts.weddings_restored += 1;
      return;
    }
    runner.problem("purge_wedding_failed");
    cronLog("error", "cron_purge_wedding_failed", {
      job: "retention",
      error_code: errorCode(error),
    });
    return;
  }
  counts.weddings_purged += 1;
  counts.files_deleted += filesDeleted;

  await sendDeletionMessages(wedding, recipients, context.now, counts);
}

/** Zpráva o trvalém smazání webu správcům; nejlepší úsilí (adresy po smazání nikde nezůstanou, nelze opakovat). */
async function sendDeletionMessages(
  wedding: DueWedding,
  recipients: readonly Recipient[],
  now: Date,
  counts: Record<string, number>,
): Promise<void> {
  if (recipients.length === 0) return;
  let secret: string;
  try {
    secret = requireEnv("AUTH_SECRET");
  } catch {
    counts.messages_failed += recipients.length;
    return;
  }
  const site = wedding.slug ? siteHostname(wedding.slug, currentHostConfig()) : undefined;
  for (const recipient of recipients) {
    const email = renderDeletionNotice({
      locale: recipient.locale,
      kind: "site_purge",
      at: now,
      timeZone: wedding.timezone,
      site,
    });
    // wedding_id je null: svatba už neexistuje (cizí klíč v email_log by selhal)
    const ok = await sendTemplatedEmail({
      type: "deletion_notice",
      to: recipient.email,
      weddingId: null,
      locale: recipient.locale,
      email,
      secret,
    }).catch(() => false);
    if (ok) counts.messages_sent += 1;
    else counts.messages_failed += 1;
  }
}
