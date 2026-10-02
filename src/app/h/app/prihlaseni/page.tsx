import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUiLocale } from "@/auth/request";
import { getSession } from "@/auth/session";
import { buttonVariants } from "@/components/ui/button";
import { createTranslator } from "@/i18n/translator";
import { AuthShell } from "../shell";
import { EmailForm } from "./forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: createTranslator(await getUiLocale())("auth.login.title") };
}

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  const t = createTranslator(await getUiLocale());
  return (
    <AuthShell title={t("auth.login.title")} intro={t("auth.login.intro")}>
      <EmailForm
        labels={{
          email: t("auth.login.email.label"),
          hint: t("auth.login.email.hint"),
          submit: t("auth.login.submit"),
          errors: {
            invalid_email: t("auth.login.error.invalidEmail"),
            limited: t("auth.login.error.limited"),
            generic: t("auth.login.error.generic"),
          },
        }}
      />
      <p className="mt-6">
        <a href="/prihlaseni/pin" className={buttonVariants({ variant: "text" })}>
          {t("auth.login.pinLink")}
        </a>
      </p>
    </AuthShell>
  );
}
