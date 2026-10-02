import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { createTranslator } from "@/i18n/translator";
import { opListOperators } from "@/lib/db/rpc-ops";
import { formatMoment } from "@/ops/format";
import { requireOperator } from "@/ops/session";
import { OpsShell, SectionTitle, TableRegion, tableClass, tdClass, thClass } from "@/ops/ui/shell";
import { CreateOperatorForm, DisableOperatorForm, ResetMfaForm } from "@/ops/ui/operator-forms";

const t = createTranslator("cs");

export const metadata: Metadata = { title: t("ops.operators.title") };

export default async function OperatorsPage() {
  const session = await requireOperator("manage_operators");
  const operators = await opListOperators(session.operatorId);
  const others = operators
    .filter((o) => o.id !== session.operatorId)
    .map((o) => ({ value: o.id, label: o.email }));

  const errors = {
    forbidden: t("ops.error.forbidden"),
    session: t("ops.error.session"),
    origin: t("ops.error.origin"),
    reason: t("ops.error.reason"),
    notFound: t("ops.error.notFound"),
    duplicate: t("ops.error.duplicate"),
    invalidEmail: t("ops.error.invalidEmail"),
    invalidRole: t("ops.error.invalidRole"),
    invalidKind: t("ops.error.invalidKind"),
    selfNotAllowed: t("ops.error.selfNotAllowed"),
    generic: t("ops.error.generic"),
  };
  const reason = { reason: t("ops.action.reason.label"), reasonHint: t("ops.action.reason.hint") };
  const never = t("ops.operators.never");

  return (
    <OpsShell session={session} current="operators" title={t("ops.operators.title")}>
      <p className="mb-6 max-w-prose">{t("ops.operators.intro")}</p>

      <section aria-labelledby="o-list" className="mb-10">
        <SectionTitle id="o-list">{t("ops.operators.table.caption")}</SectionTitle>
        <TableRegion label={t("ops.operators.table.caption")}>
          <table className={tableClass}>
            <caption className="sr-only">{t("ops.operators.table.caption")}</caption>
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  {t("ops.operators.col.email")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.operators.col.role")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.operators.col.factor")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.operators.col.backup")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.operators.col.login")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.operators.col.state")}
                </th>
              </tr>
            </thead>
            <tbody>
              {operators.map((o) => (
                <tr key={o.id}>
                  <th scope="row" className={`${tdClass} font-normal break-all`}>
                    {o.email}
                  </th>
                  <td className={tdClass}>
                    {t(o.role === "owner" ? "ops.role.owner" : "ops.role.support")}
                  </td>
                  <td className={tdClass}>
                    {o.totpConfirmed ? t("ops.operators.factor.on") : t("ops.operators.factor.off")}
                  </td>
                  <td className={tdClass}>{o.backupCodesLeft}</td>
                  <td className={tdClass}>{formatMoment(o.lastLoginAt, never)}</td>
                  <td className={tdClass}>
                    {o.disabledAt
                      ? t("ops.operators.state.disabled")
                      : t("ops.operators.state.active")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section" aria-labelledby="o-create">
          <h2 id="o-create" className="mb-3 text-xl font-medium">
            {t("ops.operators.create.title")}
          </h2>
          <CreateOperatorForm
            errors={errors}
            roles={[
              { value: "support", label: t("ops.role.support") },
              { value: "owner", label: t("ops.role.owner") },
            ]}
            labels={{
              email: t("ops.operators.create.email"),
              role: t("ops.operators.create.role"),
              submit: t("ops.operators.create.submit"),
              success: t("ops.success.operatorCreate"),
            }}
          />
        </Card>

        {others.length > 0 ? (
          <>
            <Card as="section" aria-labelledby="o-disable">
              <h2 id="o-disable" className="mb-3 text-xl font-medium">
                {t("ops.operators.disable.title")}
              </h2>
              <DisableOperatorForm
                errors={errors}
                targets={others}
                labels={{
                  target: t("ops.operators.disable.target"),
                  action: t("ops.operators.disable.action"),
                  disable: t("ops.operators.disable.disable"),
                  enable: t("ops.operators.disable.enable"),
                  ...reason,
                  submit: t("ops.operators.disable.submit"),
                  successDisable: t("ops.success.operatorDisable"),
                  successEnable: t("ops.success.operatorEnable"),
                }}
              />
            </Card>

            <Card as="section" aria-labelledby="o-reset">
              <h2 id="o-reset" className="mb-3 text-xl font-medium">
                {t("ops.operators.reset.title")}
              </h2>
              <p className="mb-3 max-w-prose">{t("ops.operators.reset.intro")}</p>
              <ResetMfaForm
                errors={errors}
                targets={others}
                labels={{
                  target: t("ops.operators.reset.target"),
                  ...reason,
                  submit: t("ops.operators.reset.submit"),
                  success: t("ops.success.operatorReset"),
                }}
              />
            </Card>
          </>
        ) : null}
      </div>
    </OpsShell>
  );
}
