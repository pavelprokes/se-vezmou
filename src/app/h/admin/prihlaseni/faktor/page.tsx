import { localHref } from "@/auth/local-href";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/ops/actions/login";
import { loadEnrollment } from "@/ops/login";
import { OPERATOR_ENROLL_PATH, OPERATOR_MFA_PATH, requireFirstFactor } from "@/ops/session";
import { groupSecret } from "@/ops/totp";
import { OpsAuthShell } from "@/ops/ui/auth-shell";
import { EnrollForm } from "@/ops/ui/login-forms";
import { OtpQr } from "@/ops/ui/qr";
import { getOpsTranslator } from "@/ops/i18n";
import { localePath } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getOpsTranslator();
  return { title: t("ops.enroll.title") };
}

export default async function EnrollFactorPage() {
  const t = await getOpsTranslator();
  const session = await requireFirstFactor();
  // Potvrzený faktor se znovu nezapisuje (jen přes obnovu majitelem).
  const enrollment = session.totpConfirmed ? null : await loadEnrollment(session);
  if (!enrollment) redirect(await localHref(OPERATOR_MFA_PATH));

  return (
    <OpsAuthShell
      path={OPERATOR_ENROLL_PATH}
      title={t("ops.enroll.title")}
      intro={t("ops.enroll.intro")}
    >
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
              continueHref: localePath("/", t.locale),
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
