import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createTranslator } from "@/i18n/translator";
import { getOperatorSession, pendingFactorPath } from "@/ops/session";
import { OpsAuthShell } from "@/ops/ui/auth-shell";
import { OperatorEmailForm } from "@/ops/ui/login-forms";

const t = createTranslator("cs");

export const metadata: Metadata = { title: t("ops.login.title") };

export default async function OperatorLoginPage() {
  const session = await getOperatorSession();
  if (session) redirect(session.aal2 ? "/" : pendingFactorPath(session));

  return (
    <OpsAuthShell title={t("ops.login.title")} intro={t("ops.login.intro")}>
      <OperatorEmailForm
        labels={{
          email: t("ops.login.email.label"),
          hint: t("ops.login.email.hint"),
          submit: t("ops.login.submit"),
          errors: {
            invalidEmail: t("ops.login.error.invalidEmail"),
            limited: t("ops.login.error.limited"),
            generic: t("ops.login.error.generic"),
          },
        }}
      />
    </OpsAuthShell>
  );
}
