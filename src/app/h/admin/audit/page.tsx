import type { Metadata } from "next";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { createTranslator } from "@/i18n/translator";
import { opListAudit, opListOperators } from "@/lib/db/rpc-ops";
import { AUDIT_PAGE_SIZE } from "@/ops/config";
import { formatMoment, isIsoDay, pragueDayStart } from "@/ops/format";
import { ACTOR_KEYS, label } from "@/ops/labels";
import { requireOperator } from "@/ops/session";
import { SelectField } from "@/ops/ui/select-field";
import { OpsShell, TableRegion, tableClass, tdClass, thClass } from "@/ops/ui/shell";

const t = createTranslator("cs");

export const metadata: Metadata = { title: t("ops.audit.title") };

type Raw = Record<string, string | string[] | undefined>;

function first(raw: Raw, key: string): string {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Filtry auditu z adresy; neplatná hodnota se zahodí. */
function parse(raw: Raw) {
  const action = first(raw, "akce").slice(0, 80);
  const wedding = z.uuid().safeParse(first(raw, "zakazka"));
  const operator = z.uuid().safeParse(first(raw, "operator"));
  const from = first(raw, "od");
  const to = first(raw, "do");
  const page = Number(first(raw, "strana"));
  return {
    action: action || undefined,
    weddingId: wedding.success ? wedding.data : undefined,
    weddingRaw: first(raw, "zakazka"),
    actorId: operator.success ? operator.data : undefined,
    from: isIsoDay(from) ? from : undefined,
    to: isIsoDay(to) ? to : undefined,
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function href(filters: ReturnType<typeof parse>, page: number): string {
  const params = new URLSearchParams();
  if (filters.action) params.set("akce", filters.action);
  if (filters.weddingId) params.set("zakazka", filters.weddingId);
  if (filters.actorId) params.set("operator", filters.actorId);
  if (filters.from) params.set("od", filters.from);
  if (filters.to) params.set("do", filters.to);
  if (page > 1) params.set("strana", String(page));
  const search = params.toString();
  return search ? `/audit?${search}` : "/audit";
}

export default async function AuditPage({ searchParams }: PageProps<"/h/admin/audit">) {
  const session = await requireOperator("audit");
  const filters = parse(await searchParams);
  const weddingInvalid = filters.weddingRaw !== "" && !filters.weddingId;

  const [operators, { rows, total }] = await Promise.all([
    opListOperators(session.operatorId),
    opListAudit(session.operatorId, {
      action: filters.action,
      weddingId: filters.weddingId,
      actorId: filters.actorId,
      from: filters.from ? pragueDayStart(filters.from) : undefined,
      // „do data včetně“: do začátku následujícího dne
      to: filters.to ? pragueDayStart(nextDay(filters.to)) : undefined,
      limit: AUDIT_PAGE_SIZE,
      offset: (filters.page - 1) * AUDIT_PAGE_SIZE,
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const none = t("ops.none");

  return (
    <OpsShell session={session} current="audit" title={t("ops.audit.title")}>
      <p className="mb-6 max-w-prose">{t("ops.audit.intro")}</p>

      <form
        action="/audit"
        method="get"
        role="search"
        className="border-hairline bg-warm mb-6 grid gap-4 rounded-2xl border p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <Field
          id="akce"
          name="akce"
          type="text"
          label={t("ops.audit.filter.action")}
          hint={t("ops.audit.filter.action.hint")}
          defaultValue={filters.action ?? ""}
          autoComplete="off"
          spellCheck={false}
        />
        <Field
          id="zakazka"
          name="zakazka"
          type="text"
          label={t("ops.audit.filter.wedding")}
          defaultValue={filters.weddingRaw}
          error={weddingInvalid ? t("ops.audit.filter.error.wedding") : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        <SelectField
          id="operator"
          name="operator"
          label={t("ops.audit.filter.operator")}
          defaultValue={filters.actorId ?? ""}
          options={[
            { value: "", label: t("ops.weddings.filter.any") },
            ...operators.map((o) => ({ value: o.id, label: o.email })),
          ]}
        />
        <Field
          id="od"
          name="od"
          type="date"
          label={t("ops.audit.filter.from")}
          defaultValue={filters.from ?? ""}
        />
        <Field
          id="do"
          name="do"
          type="date"
          label={t("ops.audit.filter.to")}
          defaultValue={filters.to ?? ""}
        />
        <div className="flex flex-wrap items-end gap-3">
          <Button type="submit">{t("ops.audit.filter.submit")}</Button>
          <a href="/audit" className={buttonVariants({ variant: "text" })}>
            {t("ops.audit.filter.reset")}
          </a>
        </div>
      </form>

      <p role="status" className="mb-3 font-medium">
        {t("ops.audit.summary", { count: total })}
      </p>

      {rows.length === 0 ? (
        <p>{t("ops.audit.empty")}</p>
      ) : (
        <TableRegion label={t("ops.audit.table.caption")}>
          <table className={tableClass.replace("min-w-[40rem]", "min-w-[56rem]")}>
            <caption className="sr-only">{t("ops.audit.table.caption")}</caption>
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  {t("ops.audit.col.when")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.audit.col.who")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.audit.col.action")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.audit.col.wedding")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.audit.col.reason")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.audit.col.meta")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className={`${tdClass} font-normal`}>
                    {formatMoment(row.at, none)}
                  </th>
                  <td className={`${tdClass} break-all`}>
                    {row.actorEmail ?? label(t, ACTOR_KEYS, row.actorType)}
                  </td>
                  <td className={`${tdClass} font-mono text-sm`}>{row.action}</td>
                  <td className={tdClass}>
                    {row.weddingId ? (
                      <a
                        href={`/zakazky/${row.weddingId}`}
                        className="text-pine inline-flex min-h-[2.75rem] items-center font-mono text-sm break-all underline underline-offset-4"
                      >
                        {row.weddingId.slice(0, 8)}
                      </a>
                    ) : (
                      none
                    )}
                  </td>
                  <td className={tdClass}>{row.reason ?? ""}</td>
                  <td className={`${tdClass} font-mono text-sm break-all`}>
                    {Object.keys(row.meta).length > 0 ? JSON.stringify(row.meta) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}

      {pages > 1 ? (
        <nav
          aria-label={t("ops.pagination.label")}
          className="mt-6 flex flex-wrap items-center gap-3"
        >
          {filters.page > 1 ? (
            <a
              href={href(filters, filters.page - 1)}
              className={buttonVariants({ variant: "secondary" })}
              rel="prev"
            >
              {t("ops.pagination.prev")}
            </a>
          ) : null}
          <p>{t("ops.pagination.page", { page: filters.page, pages })}</p>
          {filters.page < pages ? (
            <a
              href={href(filters, filters.page + 1)}
              className={buttonVariants({ variant: "secondary" })}
              rel="next"
            >
              {t("ops.pagination.next")}
            </a>
          ) : null}
        </nav>
      ) : null}
    </OpsShell>
  );
}
