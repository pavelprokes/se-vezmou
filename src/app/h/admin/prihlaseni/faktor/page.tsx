import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createTranslator } from "@/i18n/translator";
import { logoutAction } from "@/ops/actions/login";
import { loadEnrollment } from "@/ops/login";
import { OPERATOR_MFA_PATH, requireFirstFactor } from "@/ops/session";
import { groupSecret } from "@/ops/totp";
import { OpsAuthShell } from "@/ops/ui/auth-shell";
import { EnrollForm } from "@/ops/ui/login-forms";
import { OtpQr } from "@/ops/ui/qr";

const t = createTranslator("cs");

export const metadata: Metadata = { title: t("ops.enroll.title") };

export default async function EnrollFactorPage() {
  const session = await requireFirstFactor();
  // Potvrzený faktor se znovu nezapisuje (jen přes obnovu majitelem).
  const enrollment = session.totpConfirmed ? null : await loadEnrollment(session);
  if (!enrollment) redirect(OPERATOR_MFA_PATH);

  return (
    <OpsAuthShell title={t("ops.enroll.title")} intro={t("ops.enroll.intro")}>
      <div className="flex flex-col gap-6">
        <section aria-labelledby="enroll-step1" className="flex flex-col gap-3">
          <h2 id="enroll-step1" className="text-ink text-xl font-medium">
            {t("ops.enroll.step1")}
          </h2>
          <OtpQr payload={enrollment.uri} label={t("ops.enroll.qr.label")} />
          <p className="text-ink font-medium">{t("ops.enroll.secret.label")}</p>
          <p className="bg-parchment border-hairline rounded-button border p-3 font-mono text-lg break-all">
            {groupSecret(enrollment.secret)}
          </p>
        </section>
        <section aria-labelledby="enroll-step2" className="flex flex-col gap-3">
          <h2 id="enroll-step2" className="text-ink text-xl font-medium">
            {t("ops.enroll.step2")}
          </h2>
          <EnrollForm
            labels={{
              code: t("ops.enroll.code.label"),
              hint: t("ops.enroll.code.hint"),
              submit: t("ops.enroll.submit"),
              errors: {
                format: t("ops.enroll.error.format"),
                invalid: t("ops.enroll.error.invalid"),
                // Zástupný znak {pause} doplní formulář podle délky pauzy.
                locked: t("ops.mfa.error.locked", { pause: "{pause}" }),
                limited: t("ops.login.error.limited"),
                session: t("ops.mfa.error.session"),
                generic: t("ops.login.error.generic"),
              },
              codesTitle: t("ops.enroll.codes.title"),
              codesIntro: t("ops.enroll.codes.intro"),
              codesList: t("ops.enroll.codes.list"),
              continue: t("ops.enroll.codes.continue"),
            }}
          />
        </section>
        <form action={logoutAction}>
          <Button type="submit" variant="text">
            {t("ops.mfa.restart")}
          </Button>
        </form>
      </div>
    </OpsAuthShell>
  );
}
