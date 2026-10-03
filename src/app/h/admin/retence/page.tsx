import type { Metadata } from "next";
import type { WeddingStatus } from "@/lib/db/types";
import { expiringWeddings, jobRunsSummary } from "@/lib/lifecycle/operator";
import { RETENTION_WINDOW_DAYS } from "@/ops/config";
import { coupleNames, formatMoment } from "@/ops/format";
import {
  JOB_STATUS_KEYS,
  NOTICE_STATUS_KEYS,
  RETENTION_KEYS,
  STATUS_KEYS,
  label,
} from "@/ops/labels";
import { requireOperator } from "@/ops/session";
import { OpsShell, SectionTitle, TableRegion, tableClass, tdClass, thClass } from "@/ops/ui/shell";
import { getOpsTranslator } from "@/ops/i18n";
import { localePath } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getOpsTranslator();
  return { title: t("ops.retention.title") };
}

/**
 * Weby před vypršením provozu a lhůt pro smazání (FR-OPS-5) a běhy plánovaných úloh (M10). Stránka nic
 * nemaže ani nespouští, jen ukazuje termíny a stav; data dodávají `op_expiring_weddings` a `op_job_runs_summary`.
 */
export default async function RetentionPage() {
  const t = await getOpsTranslator();
  const session = await requireOperator("view");
  const [rows, jobs] = await Promise.all([
    expiringWeddings(session.operatorId, RETENTION_WINDOW_DAYS),
    jobRunsSummary(session.operatorId),
  ]);
  const none = t("ops.none");
  const notice = (status: string | null) =>
    status ? label(t, NOTICE_STATUS_KEYS, status) : t("ops.notices.none");

  return (
    <OpsShell session={session} current="retention" title={t("ops.retention.title")}>
      <p className="mb-6 max-w-prose">
        {t("ops.retention.intro", { days: RETENTION_WINDOW_DAYS })}
      </p>

      <section aria-labelledby="r-expiring" className="mb-10">
        <SectionTitle id="r-expiring">{t("ops.retention.caption")}</SectionTitle>
        {rows.length === 0 ? (
          <p>{t("ops.retention.empty")}</p>
        ) : (
          <TableRegion label={t("ops.retention.caption")}>
            <table className={tableClass.replace("min-w-[40rem]", "min-w-[60rem]")}>
              <caption className="sr-only">{t("ops.retention.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>
                    {t("ops.weddings.col.names")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.weddings.col.slug")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.weddings.col.status")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.retention.col.what")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.retention.col.due")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.retention.col.days")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.retention.col.first")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.retention.col.final")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.wedding_id}-${row.kind}`}>
                    <th scope="row" className={`${tdClass} font-medium`}>
                      <a
                        href={localePath(`/zakazky/${row.wedding_id}`, t.locale)}
                        className="text-pine inline-flex min-h-[2.75rem] items-center underline underline-offset-4"
                      >
                        {coupleNames(row.partner_a_name, row.partner_b_name)}
                      </a>
                    </th>
                    <td className={tdClass}>{row.slug ?? t("ops.weddings.noSlug")}</td>
                    <td className={tdClass}>
                      {label(t, STATUS_KEYS, row.status as WeddingStatus)}
                    </td>
                    <td className={tdClass}>{label(t, RETENTION_KEYS, row.kind)}</td>
                    <td className={tdClass}>{formatMoment(row.event_at, none)}</td>
                    <td className={tdClass}>
                      {row.days_left}
                      {row.overdue ? ` (${t("ops.retention.overdue")})` : ""}
                    </td>
                    <td className={tdClass}>{notice(row.first_notice_status)}</td>
                    <td className={tdClass}>{notice(row.final_notice_status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        )}
      </section>

      <section aria-labelledby="r-jobs">
        <SectionTitle id="r-jobs">{t("ops.jobs.title")}</SectionTitle>
        <p className="text-muted mb-3 max-w-prose">{t("ops.jobs.intro")}</p>
        {jobs.length === 0 ? (
          <p>{t("ops.jobs.none")}</p>
        ) : (
          <TableRegion label={t("ops.jobs.caption")}>
            <table className={tableClass}>
              <caption className="sr-only">{t("ops.jobs.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>
                    {t("ops.jobs.col.job")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.jobs.col.status")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.jobs.col.last")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.jobs.col.ok")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.jobs.col.failures")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.job}>
                    <th scope="row" className={`${tdClass} font-mono text-sm font-normal`}>
                      {job.job}
                    </th>
                    <td className={tdClass}>{label(t, JOB_STATUS_KEYS, job.last_status)}</td>
                    <td className={tdClass}>{formatMoment(job.last_started_at, none)}</td>
                    <td className={tdClass}>{formatMoment(job.last_ok_at, none)}</td>
                    <td className={tdClass}>{job.failures_7d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        )}
      </section>
    </OpsShell>
  );
}
