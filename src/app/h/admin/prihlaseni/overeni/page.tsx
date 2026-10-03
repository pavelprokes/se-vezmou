import { localHref } from "@/auth/local-href";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/ops/actions/login";
import { OPERATOR_ENROLL_PATH, OPERATOR_MFA_PATH, requireFirstFactor } from "@/ops/session";
import { OpsAuthShell } from "@/ops/ui/auth-shell";
import { SecondFactorForm } from "@/ops/ui/login-forms";
import { getOpsTranslator } from "@/ops/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getOpsTranslator();
  return { title: t("ops.mfa.title") };
}

export default async function SecondFactorPage() {
  const t = await getOpsTranslator();
  const session = await requireFirstFactor();
  if (!session.totpConfirmed) redirect(await localHref(OPERATOR_ENROLL_PATH));

  return (
    <OpsAuthShell path={OPERATOR_MFA_PATH} title={t("ops.mfa.title")} intro={t("ops.mfa.intro")}>
      <SecondFactorForm
        labels={{
          code: t("ops.mfa.label"),
          hint: t("ops.mfa.hint"),
          submit: t("ops.mfa.submit"),
          errors: {
            format: t("ops.mfa.error.format"),
            invalid: t("ops.mfa.error.invalid"),
            // Zástupný znak {pause} doplní formulář podle délky pauzy.
            locked: t("ops.mfa.error.locked", { pause: "{pause}" }),
            limited: t("ops.login.error.limited"),
            session: t("ops.mfa.error.session"),
            generic: t("ops.login.error.generic"),
          },
        }}
      />
      <form action={logoutAction} className="mt-6">
        <Button type="submit" variant="text">
          {t("ops.mfa.restart")}
        </Button>
      </form>
    </OpsAuthShell>
  );
}
