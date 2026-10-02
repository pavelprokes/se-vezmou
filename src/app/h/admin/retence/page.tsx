import type { Metadata } from "next";
import { createTranslator } from "@/i18n/translator";
import { opListRetention } from "@/lib/db/rpc-ops";
import { RETENTION_WINDOW_DAYS } from "@/ops/config";
import { coupleNames, formatMoment } from "@/ops/format";
import { RETENTION_KEYS, STATUS_KEYS } from "@/ops/labels";
import { requireOperator } from "@/ops/session";
import { OpsShell, TableRegion, tableClass, tdClass, thClass } from "@/ops/ui/shell";

const t = createTranslator("cs");

export const metadata: Metadata = { title: t("ops.retention.title") };

/** Seznam zakázek před vypršením provozu a lhůt pro smazání (FR-OPS-5). Nic nemaže, jen ukazuje termíny. */
export default async function RetentionPage() {
  const session = await requireOperator("view");
  const rows = await opListRetention(session.operatorId, RETENTION_WINDOW_DAYS);

  return (
    <OpsShell session={session} current="retention" title={t("ops.retention.title")}>
      <p className="mb-6 max-w-prose">
        {t("ops.retention.intro", { days: RETENTION_WINDOW_DAYS })}
      </p>
      {rows.length === 0 ? (
        <p>{t("ops.retention.empty")}</p>
      ) : (
        <TableRegion label={t("ops.retention.caption")}>
          <table className={tableClass}>
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
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.weddingId}-${row.kind}`}>
                  <th scope="row" className={`${tdClass} font-medium`}>
                    <a
                      href={`/zakazky/${row.weddingId}`}
                      className="text-pine inline-flex min-h-[2.75rem] items-center underline underline-offset-4"
                    >
                      {coupleNames(row.partnerAName, row.partnerBName)}
                    </a>
                  </th>
                  <td className={tdClass}>{row.slug ?? t("ops.weddings.noSlug")}</td>
                  <td className={tdClass}>{t(STATUS_KEYS[row.status])}</td>
                  <td className={tdClass}>{t(RETENTION_KEYS[row.kind])}</td>
                  <td className={tdClass}>
                    {formatMoment(row.dueAt, t("ops.none"))}
                    {row.overdue ? ` (${t("ops.retention.overdue")})` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}
    </OpsShell>
  );
}
