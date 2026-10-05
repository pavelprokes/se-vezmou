import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { listMyWeddings } from "@/admin/site/server";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { WeddingPicker } from "@/components/admin/wedding-picker";
import { getTranslator } from "@/i18n/load";
import { switchWeddingAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["admin"]))("admin.picker.title"),
  };
}

/**
 * Výběr svatby, když jeden e-mail spravuje víc svateb: sem vede přihlášení (relace zatím patří
 * nejstarší svatbě) i odkaz „Přepnout svatbu“ v hlavičce. S jedinou svatbou není co vybírat.
 */
export default async function WeddingsPage() {
  const session = await requireSession();
  const locale = await getUiLocale();
  const [t, weddings] = await Promise.all([
    getTranslator(locale, ["common", "admin"]),
    listMyWeddings(session),
  ]);
  if (weddings.length < 2) redirect(appHref(ADMIN_PATHS.overview, locale));

  return (
    <AdminFrame
      locale={locale}
      path={ADMIN_PATHS.weddings}
      title={t("admin.picker.title")}
      intro={t("admin.picker.intro")}
      help="overview"
    >
      <AdminI18nProvider locale={locale} messages={await pickAdminMessages(locale)}>
        <WeddingPicker
          action={switchWeddingAction}
          continueHref={appHref(ADMIN_PATHS.overview, locale)}
          weddings={weddings.map((wedding) => ({
            weddingId: wedding.weddingId,
            names: `${wedding.partnerAName} ${t("common.and")} ${wedding.partnerBName}`,
            site: wedding.slug,
            isCurrent: wedding.isCurrent,
          }))}
        />
      </AdminI18nProvider>
    </AdminFrame>
  );
}
