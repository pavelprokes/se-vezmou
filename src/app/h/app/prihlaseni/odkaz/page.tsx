import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { openLoginLink } from "@/auth/login";
import { getUiLocale } from "@/auth/request";
import { localHref } from "@/auth/local-href";
import { getSession } from "@/auth/session";
import { buttonVariants } from "@/components/ui/button";
import { getTranslator } from "@/i18n/load";
import { AuthShell } from "../../shell";
import { LinkConfirmForm } from "../forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator(await getUiLocale(), ["auth"]))("auth.link.title") };
}

/**
 * Odkaz z e-mailu nic nespotřebuje: zobrazí jen potvrzení. Přihlásí až odeslání formuláře
 * (POST), takže ho nespotřebuje ani skener schránky, který odkaz jen otevře (GET).
 */
export default async function LinkPage({ searchParams }: PageProps<"/h/app/prihlaseni/odkaz">) {
  if (await getSession()) redirect(await localHref("/"));
  const t = await getTranslator(await getUiLocale(), ["auth"]);
  const loginHref = await localHref("/prihlaseni");
  const raw = (await searchParams).t;
  const token = typeof raw === "string" ? raw : null;

  if (!token || !openLoginLink(token)) {
    return (
      <AuthShell
        locale={t.locale}
        path="/prihlaseni/odkaz"
        title={t("auth.link.invalid.title")}
        intro={t("auth.link.invalid.body")}
      >
        <a href={loginHref} className={buttonVariants({ fullWidth: true })}>
          {t("auth.link.invalid.action")}
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      locale={t.locale}
      path={`/prihlaseni/odkaz?t=${encodeURIComponent(token)}`}
      title={t("auth.link.title")}
      intro={t("auth.link.body")}
    >
      <LinkConfirmForm
        token={token}
        labels={{
          submit: t("auth.link.submit"),
          errors: {
            wrong: t("auth.link.error.wrong"),
            limited: t("auth.login.error.limited"),
            generic: t("auth.login.error.generic"),
          },
        }}
      />
    </AuthShell>
  );
}
