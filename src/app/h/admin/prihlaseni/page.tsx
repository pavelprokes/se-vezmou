import { localHref } from "@/auth/local-href";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOperatorSession, pendingFactorPath } from "@/ops/session";
import { OpsAuthShell } from "@/ops/ui/auth-shell";
import { OperatorEmailForm } from "@/ops/ui/login-forms";
import { getOpsTranslator } from "@/ops/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getOpsTranslator();
  return { title: t("ops.login.title") };
}

export default async function OperatorLoginPage() {
  const t = await getOpsTranslator();
  const session = await getOperatorSession();
  if (session) redirect(await localHref(session.aal2 ? "/" : pendingFactorPath(session)));

  return (
    <OpsAuthShell path="/prihlaseni" title={t("ops.login.title")} intro={t("ops.login.intro")}>
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
