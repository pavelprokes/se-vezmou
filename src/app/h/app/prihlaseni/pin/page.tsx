import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUiLocale } from "@/auth/request";
import { localHref } from "@/auth/local-href";
import { getSession } from "@/auth/session";
import { buttonVariants } from "@/components/ui/button";
import { getTranslator } from "@/i18n/load";
import { AuthShell } from "../../shell";
import { PinForm } from "../forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator(await getUiLocale(), ["auth"]))("auth.pin.title") };
}

export default async function PinLoginPage() {
  if (await getSession()) redirect(await localHref("/"));
  const t = await getTranslator(await getUiLocale(), ["auth"]);
  const loginHref = await localHref("/prihlaseni");
  return (
    <AuthShell
      locale={t.locale}
      path="/prihlaseni/pin"
      title={t("auth.pin.title")}
      intro={t("auth.pin.intro")}
    >
      <PinForm
        labels={{
          slug: t("auth.pin.slug.label"),
          slugHint: t("auth.pin.slug.hint"),
          pin: t("auth.pin.pin.label"),
          pinHint: t("auth.pin.pin.hint"),
          submit: t("auth.pin.submit"),
          errors: {
            invalid: t("auth.pin.error.invalid"),
            // Zástupný znak {pause} doplní formulář podle délky pauzy.
            locked: t("auth.pin.error.locked", { pause: "{pause}" }),
            limited: t("auth.pin.error.limited"),
            generic: t("auth.login.error.generic"),
          },
        }}
      />
      <p className="mt-6">
        <a href={loginHref} className={buttonVariants({ variant: "text" })}>
          {t("auth.pin.emailLink")}
        </a>
      </p>
    </AuthShell>
  );
}
