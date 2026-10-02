import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { currentHostConfig, siteHostname } from "@/auth/app-origin";
import { Button } from "@/components/ui/button";
import { createTranslator } from "@/i18n/translator";
import { authSessionContext } from "@/lib/db/rpc";
import { logoutAction } from "./prihlaseni/actions";
import { AuthShell } from "./shell";

export async function generateMetadata(): Promise<Metadata> {
  return { title: createTranslator(await getUiLocale())("auth.dashboard.title") };
}

/**
 * Chráněný zástupný přehled. Bez platné relace přesměruje na přihlášení. Průvodce a správa
 * webu přijdou v dalších milnících (M5, M7).
 */
export default async function DashboardPage() {
  const session = await requireSession();
  const context = await authSessionContext(session.weddingId);
  if (!context) notFound();

  const t = createTranslator(await getUiLocale());
  const site = context.slug ? siteHostname(context.slug, currentHostConfig()) : null;
  return (
    <AuthShell
      title={t("auth.dashboard.title")}
      intro={t("auth.dashboard.welcome", {
        names: `${context.partnerAName} ${t("common.and")} ${context.partnerBName}`,
      })}
    >
      <p>{site ? t("auth.dashboard.site", { site }) : t("auth.dashboard.noSite")}</p>
      <p className="text-muted mt-3">{t("auth.dashboard.placeholder")}</p>
      <form action={logoutAction} className="mt-6">
        <Button type="submit" variant="secondary">
          {t("auth.logout.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
