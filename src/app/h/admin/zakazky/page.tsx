import type { Metadata } from "next";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { opListWeddings } from "@/lib/db/rpc-ops";
import { WEDDING_STATUSES } from "@/lib/db/types";
import { PAGE_SIZE } from "@/ops/config";
import { LOCALE_KEYS, STATUS_KEYS, TEMPLATE_KEYS, label } from "@/ops/labels";
import { coupleNames, formatDay, formatMoment } from "@/ops/format";
import { LOCALES, TEMPLATES, listHref, parseListQuery, toFilters } from "@/ops/list-query";
import { requireOperator } from "@/ops/session";
import { SelectField } from "@/ops/ui/select-field";
import { OpsShell, TableRegion, tableClass, tdClass, thClass } from "@/ops/ui/shell";
import { getOpsTranslator } from "@/ops/i18n";
import { localePath } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getOpsTranslator();
  return { title: t("ops.weddings.title") };
}

export default async function WeddingsPage({ searchParams }: PageProps<"/h/admin/zakazky">) {
  const t = await getOpsTranslator();
  const session = await requireOperator("view");
  const query = parseListQuery(await searchParams);
  const { rows, total } = await opListWeddings(session.operatorId, toFilters(query));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const any = { value: "", label: t("ops.weddings.filter.any") };

  return (
    <OpsShell session={session} current="weddings" title={t("ops.weddings.title")}>
      <form
        action={localePath("/zakazky", t.locale)}
        method="get"
        role="search"
        className="border-hairline bg-warm mb-6 grid gap-4 rounded-2xl border p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <Field
          id="q"
          name="q"
          type="search"
          label={t("ops.weddings.search.label")}
          hint={t("ops.weddings.search.hint")}
          defaultValue={query.query ?? ""}
          autoComplete="off"
          spellCheck={false}
          className="sm:col-span-2 lg:col-span-3"
        />
        <SelectField
          id="stav"
          name="stav"
          label={t("ops.weddings.filter.status")}
          defaultValue={query.status ?? ""}
          options={[
            any,
            ...WEDDING_STATUSES.map((status) => ({
              value: status,
              label: t(STATUS_KEYS[status]),
            })),
          ]}
        />
        <SelectField
          id="jazyk"
          name="jazyk"
          label={t("ops.weddings.filter.locale")}
          defaultValue={query.locale ?? ""}
          options={[any, ...LOCALES.map((l) => ({ value: l, label: label(t, LOCALE_KEYS, l) }))]}
        />
        <SelectField
          id="sablona"
          name="sablona"
          label={t("ops.weddings.filter.template")}
          defaultValue={query.template ?? ""}
          options={[
            any,
            ...TEMPLATES.map((s) => ({ value: s, label: label(t, TEMPLATE_KEYS, s) })),
          ]}
        />
        <Field
          id="mesic"
          name="mesic"
          type="month"
          label={t("ops.weddings.filter.month")}
          hint={t("ops.weddings.filter.month.hint")}
          defaultValue={query.month ?? ""}
          pattern="\d{4}-\d{2}"
        />
        <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-3">
          <Button type="submit">{t("ops.weddings.filter.submit")}</Button>
          <a
            href={localePath("/zakazky", t.locale)}
            className={buttonVariants({ variant: "text" })}
          >
            {t("ops.weddings.filter.reset")}
          </a>
        </div>
      </form>

      <p role="status" className="mb-3 font-medium">
        {t("ops.weddings.summary", { count: total })}
      </p>

      {rows.length === 0 ? (
        <p>{t("ops.weddings.empty")}</p>
      ) : (
        <TableRegion label={t("ops.weddings.table.caption")}>
          <table className={tableClass}>
            <caption className="sr-only">{t("ops.weddings.table.caption")}</caption>
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
                  {t("ops.weddings.col.date")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.weddings.col.template")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.weddings.col.locales")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.weddings.col.admins")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.weddings.col.activity")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className={`${tdClass} font-medium`}>
                    <a
                      href={localePath(`/zakazky/${row.id}`, t.locale)}
                      className="text-pine inline-flex min-h-[2.75rem] items-center underline underline-offset-4"
                    >
                      {coupleNames(row.partnerAName, row.partnerBName)}
                    </a>
                  </th>
                  <td className={tdClass}>{row.slug ?? t("ops.weddings.noSlug")}</td>
                  <td className={tdClass}>{t(STATUS_KEYS[row.status])}</td>
                  <td className={tdClass}>{formatDay(row.startsOn, t("ops.weddings.noDate"))}</td>
                  <td className={tdClass}>{label(t, TEMPLATE_KEYS, row.template)}</td>
                  <td className={tdClass}>
                    {row.locales.map((l) => label(t, LOCALE_KEYS, l)).join(", ")}
                  </td>
                  <td className={tdClass}>{row.adminCount}</td>
                  <td className={tdClass}>{formatMoment(row.lastActivityAt, t("ops.none"))}</td>
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
          {query.page > 1 ? (
            <a
              href={listHref(query, query.page - 1, t.locale)}
              className={buttonVariants({ variant: "secondary" })}
              rel="prev"
            >
              {t("ops.pagination.prev")}
            </a>
          ) : null}
          <p>{t("ops.pagination.page", { page: query.page, pages })}</p>
          {query.page < pages ? (
            <a
              href={listHref(query, query.page + 1, t.locale)}
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
