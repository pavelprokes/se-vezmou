import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createTranslator } from "@/i18n/translator";
import { logoutAction } from "@/ops/actions/login";
import { OPERATOR_ENROLL_PATH, requireFirstFactor } from "@/ops/session";
import { OpsAuthShell } from "@/ops/ui/auth-shell";
import { SecondFactorForm } from "@/ops/ui/login-forms";

const t = createTranslator("cs");

export const metadata: Metadata = { title: t("ops.mfa.title") };

export default async function SecondFactorPage() {
  const session = await requireFirstFactor();
  if (!session.totpConfirmed) redirect(OPERATOR_ENROLL_PATH);

  return (
    <OpsAuthShell title={t("ops.mfa.title")} intro={t("ops.mfa.intro")}>
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
