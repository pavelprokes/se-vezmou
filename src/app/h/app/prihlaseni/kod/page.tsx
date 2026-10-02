import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { openPendingLogin } from "@/auth/login";
import { cookieSpec } from "@/auth/cookie";
import { getHost, getUiLocale } from "@/auth/request";
import { getSession } from "@/auth/session";
import { buttonVariants } from "@/components/ui/button";
import { createTranslator } from "@/i18n/translator";
import { AuthShell } from "../../shell";
import { CodeForm } from "../forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: createTranslator(await getUiLocale())("auth.code.title") };
}

export default async function CodePage() {
  if (await getSession()) redirect("/");

  // Kód se zadává jen v prohlížeči, který ho vyžádal; jinak zpět na e-mail.
  const pending = (await cookies()).get(cookieSpec("pending", await getHost()).name)?.value;
  if (!pending || !openPendingLogin(pending)) redirect("/prihlaseni");

  const t = createTranslator(await getUiLocale());
  return (
    <AuthShell title={t("auth.code.title")} intro={t("auth.code.intro")}>
      <CodeForm
        labels={{
          code: t("auth.code.label"),
          hint: t("auth.code.hint"),
          submit: t("auth.code.submit"),
          errors: {
            format: t("auth.code.error.format"),
            wrong: t("auth.code.error.wrong"),
            expired: t("auth.code.error.expired"),
            limited: t("auth.code.error.limited"),
            generic: t("auth.login.error.generic"),
          },
        }}
      />
      <p className="mt-6">
        <a href="/prihlaseni" className={buttonVariants({ variant: "text" })}>
          {t("auth.code.resend")}
        </a>
      </p>
    </AuthShell>
  );
}
