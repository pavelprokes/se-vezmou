import { localHref } from "@/auth/local-href";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieSpec } from "@/auth/cookie";
import { getHost } from "@/auth/request";
import { buttonVariants } from "@/components/ui/button";
import { openOperatorPending } from "@/ops/login";
import { getOperatorSession, pendingFactorPath } from "@/ops/session";
import { OpsAuthShell } from "@/ops/ui/auth-shell";
import { OperatorCodeForm } from "@/ops/ui/login-forms";
import { getOpsTranslator } from "@/ops/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getOpsTranslator();
  return { title: t("ops.code.title") };
}

export default async function OperatorCodePage() {
  const t = await getOpsTranslator();
  const session = await getOperatorSession();
  if (session) redirect(await localHref(session.aal2 ? "/" : pendingFactorPath(session)));

  // Kód se zadává jen v prohlížeči, který ho vyžádal; jinak zpět na e-mail.
  const pending = (await cookies()).get(cookieSpec("operatorPending", await getHost()).name)?.value;
  if (!pending || !openOperatorPending(pending)) redirect(await localHref("/prihlaseni"));

  return (
    <OpsAuthShell path="/prihlaseni/kod" title={t("ops.code.title")} intro={t("ops.code.intro")}>
      <OperatorCodeForm
        labels={{
          code: t("ops.code.label"),
          hint: t("ops.code.hint"),
          submit: t("ops.code.submit"),
          errors: {
            format: t("ops.code.error.format"),
            wrong: t("ops.code.error.wrong"),
            expired: t("ops.code.error.expired"),
            limited: t("ops.login.error.limited"),
            generic: t("ops.login.error.generic"),
          },
        }}
      />
      <p className="mt-6">
        <a href="/prihlaseni" className={buttonVariants({ variant: "text" })}>
          {t("ops.code.resend")}
        </a>
      </p>
    </OpsAuthShell>
  );
}
