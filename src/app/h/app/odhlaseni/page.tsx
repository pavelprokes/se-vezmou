import type { Metadata } from "next";
import { getUiLocale } from "@/auth/request";
import { localHref } from "@/auth/local-href";
import { requireSession } from "@/auth/session";
import { Button, buttonVariants } from "@/components/ui/button";
import { getTranslator } from "@/i18n/load";
import { logoutAction } from "../prihlaseni/actions";
import { AuthShell } from "../shell";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator(await getUiLocale(), ["auth"]))("auth.logout.title") };
}

/** Odhlášení je mutace (POST přes formulář), ne odkaz: nejde ho vyvolat cizí stránkou. */
export default async function LogoutPage() {
  await requireSession();
  const t = await getTranslator(await getUiLocale(), ["auth"]);
  const homeHref = await localHref("/");
  return (
    <AuthShell
      locale={t.locale}
      path="/odhlaseni"
      title={t("auth.logout.title")}
      intro={t("auth.logout.body")}
    >
      <form action={logoutAction} className="flex flex-col gap-4">
        <Button type="submit" fullWidth>
          {t("auth.logout.submit")}
        </Button>
        <a href={homeHref} className={buttonVariants({ variant: "secondary", fullWidth: true })}>
          {t("auth.logout.cancel")}
        </a>
      </form>
    </AuthShell>
  );
}
