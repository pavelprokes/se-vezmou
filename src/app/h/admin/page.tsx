import type { Metadata } from "next";
import { createTranslator } from "@/i18n/translator";
import { opAnalyticsSummary, opOverview, type AnalyticsRow } from "@/lib/db/rpc-ops";
import { WEDDING_STATUSES } from "@/lib/db/types";
import { ANALYTICS_WINDOW_DAYS } from "@/ops/config";
import { formatMonth } from "@/ops/format";
import { EVENT_KEYS, LOCALE_KEYS, STATUS_KEYS, TEMPLATE_KEYS, label } from "@/ops/labels";
import { requireOperator } from "@/ops/session";
import { OpsShell, SectionTitle, TableRegion, tableClass, tdClass, thClass } from "@/ops/ui/shell";

const t = createTranslator("cs");

export const metadata: Metadata = { title: t("ops.overview.title") };

function CountTable({
  caption,
  firstColumn,
  rows,
}: {
  caption: string;
  firstColumn: string;
  rows: { label: string; count: number }[];
}) {
  return (
    <TableRegion label={caption}>
      <table className={tableClass.replace("min-w-[40rem]", "min-w-[18rem]")}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={thClass}>
              {firstColumn}
            </th>
            <th scope="col" className={thClass}>
              {t("ops.overview.col.count")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className={`${tdClass} font-normal`}>
                {row.label}
              </th>
              <td className={tdClass}>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableRegion>
  );
}

/** Souhrn analytiky po událostech; kroky průvodce zvlášť (bez rozpadu podle jazyka a šablony). */
function summarize(rows: AnalyticsRow[]) {
  const events = new Map<string, number>();
  const steps = new Map<number, number>();
  for (const row of rows) {
    events.set(row.event, (events.get(row.event) ?? 0) + row.events);
    if (row.event === "wizard_step_completed" && row.step !== null) {
      steps.set(row.step, (steps.get(row.step) ?? 0) + row.events);
    }
  }
  return { events, steps };
}

export default async function OverviewPage() {
  const session = await requireOperator("view");
  const [overview, analytics] = await Promise.all([
    opOverview(session.operatorId),
    opAnalyticsSummary(session.operatorId, ANALYTICS_WINDOW_DAYS),
  ]);
  const { events, steps } = summarize(analytics);

  return (
    <OpsShell session={session} current="overview" title={t("ops.overview.title")}>
      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="ov-status">
          <SectionTitle id="ov-status">{t("ops.overview.status.title")}</SectionTitle>
          <CountTable
            caption={t("ops.overview.status.title")}
            firstColumn={t("ops.overview.col.status")}
            rows={WEDDING_STATUSES.map((status) => ({
              label: label(t, STATUS_KEYS, status),
              count: overview.by_status[status] ?? 0,
            }))}
          />
        </section>

        <section aria-labelledby="ov-months">
          <SectionTitle id="ov-months">{t("ops.overview.months.title")}</SectionTitle>
          {overview.by_month.length > 0 ? (
            <CountTable
              caption={t("ops.overview.months.title")}
              firstColumn={t("ops.overview.col.month")}
              rows={overview.by_month.map((m) => ({
                label: formatMonth(m.month),
                count: m.count,
              }))}
            />
          ) : (
            <p>{t("ops.overview.months.none")}</p>
          )}
          <p className="mt-3">{t("ops.overview.withoutDate", { count: overview.without_date })}</p>
        </section>

        <section aria-labelledby="ov-template">
          <SectionTitle id="ov-template">{t("ops.overview.template.title")}</SectionTitle>
          <CountTable
            caption={t("ops.overview.template.title")}
            firstColumn={t("ops.overview.col.template")}
            rows={Object.keys(TEMPLATE_KEYS).map((template) => ({
              label: label(t, TEMPLATE_KEYS, template),
              count: overview.by_template[template] ?? 0,
            }))}
          />
        </section>

        <section aria-labelledby="ov-locale">
          <SectionTitle id="ov-locale">{t("ops.overview.locale.title")}</SectionTitle>
          <CountTable
            caption={t("ops.overview.locale.title")}
            firstColumn={t("ops.overview.col.locale")}
            rows={Object.keys(LOCALE_KEYS).map((locale) => ({
              label: label(t, LOCALE_KEYS, locale),
              count: overview.by_locale[locale] ?? 0,
            }))}
          />
        </section>

        <section aria-labelledby="ov-analytics" className="lg:col-span-2">
          <SectionTitle id="ov-analytics">
            {t("ops.overview.analytics.title", { days: ANALYTICS_WINDOW_DAYS })}
          </SectionTitle>
          <p className="text-muted mb-3 max-w-prose">{t("ops.overview.analytics.intro")}</p>
          {events.size === 0 ? (
            <p>{t("ops.overview.analytics.none")}</p>
          ) : (
            <div className="grid gap-8 md:grid-cols-2">
              <CountTable
                caption={t("ops.overview.analytics.title", { days: ANALYTICS_WINDOW_DAYS })}
                firstColumn={t("ops.overview.col.event")}
                rows={[...events.entries()].map(([event, count]) => ({
                  label: label(t, EVENT_KEYS, event),
                  count,
                }))}
              />
              {steps.size > 0 ? (
                <CountTable
                  caption={t("ops.overview.analytics.steps")}
                  firstColumn={t("ops.overview.col.step")}
                  rows={[...steps.entries()]
                    .sort((a, b) => a[0] - b[0])
                    .map(([step, count]) => ({ label: String(step), count }))}
                />
              ) : null}
            </div>
          )}
        </section>
      </div>
    </OpsShell>
  );
}
