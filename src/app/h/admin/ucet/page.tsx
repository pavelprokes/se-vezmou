import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { createTranslator } from "@/i18n/translator";
import { authOperatorBackupCodesLeft } from "@/lib/db/rpc-ops";
import { requireOperator } from "@/ops/session";
import { RegenerateCodesForm } from "@/ops/ui/login-forms";
import { OpsShell } from "@/ops/ui/shell";

const t = createTranslator("cs");

export const metadata: Metadata = { title: t("ops.account.title") };

export default async function AccountPage() {
  const session = await requireOperator("view");
  const left = await authOperatorBackupCodesLeft(session.operatorId);

  return (
    <OpsShell session={session} current="account" title={t("ops.account.title")}>
      <dl className="mb-8 max-w-xl">
        <div className="border-hairline border-b py-2 sm:grid sm:grid-cols-[14rem_1fr] sm:gap-4">
          <dt className="text-muted font-medium">{t("ops.account.email")}</dt>
          <dd className="break-all">{session.email}</dd>
        </div>
        <div className="border-hairline border-b py-2 sm:grid sm:grid-cols-[14rem_1fr] sm:gap-4">
          <dt className="text-muted font-medium">{t("ops.account.role")}</dt>
          <dd>{t(session.role === "owner" ? "ops.role.owner" : "ops.role.support")}</dd>
        </div>
        <div className="border-hairline border-b py-2 sm:grid sm:grid-cols-[14rem_1fr] sm:gap-4">
          <dt className="text-muted font-medium">{t("ops.account.factor")}</dt>
          <dd>{t("ops.account.factor.on")}</dd>
        </div>
        <div className="border-hairline border-b py-2 sm:grid sm:grid-cols-[14rem_1fr] sm:gap-4">
          <dt className="text-muted font-medium">{t("ops.account.backup")}</dt>
          <dd>{left}</dd>
        </div>
      </dl>

      <Card as="section" aria-labelledby="acc-regen" className="max-w-xl">
        <h2 id="acc-regen" className="mb-3 text-xl font-medium">
          {t("ops.account.regenerate.title")}
        </h2>
        <p className="mb-3">{t("ops.account.regenerate.intro")}</p>
        <RegenerateCodesForm
          labels={{
            submit: t("ops.account.regenerate.submit"),
            errors: {
              session: t("ops.error.session"),
              origin: t("ops.error.origin"),
              forbidden: t("ops.error.forbidden"),
              generic: t("ops.error.generic"),
            },
            codesTitle: t("ops.account.codes.title"),
            codesIntro: t("ops.account.codes.intro"),
            codesList: t("ops.enroll.codes.list"),
          }}
        />
      </Card>
    </OpsShell>
  );
}
