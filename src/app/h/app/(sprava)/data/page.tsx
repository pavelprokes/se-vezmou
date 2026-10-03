import { Download } from "lucide-react";
import type { Metadata } from "next";
import { loadAccess } from "@/admin/access/server";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { DeleteSite } from "@/components/admin/guests/delete-site";
import { ExportForm } from "@/components/admin/guests/export-form";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { getTranslator } from "@/i18n/load";
import { deleteSiteAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["admin.guests"]))("admin.guests.nav.data"),
  };
}

/**
 * Data a smazání (FR-LC-1, FR-LC-2): export všeho, co pár o hostech ví, a smazání webu s ochrannou
 * lhůtou. Export je první, protože smazání je pro pár nevratné; trvalé smazání provede retenční
 * úloha (M10) až po lhůtě.
 */
export default async function DataPage() {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin.guests"]);
  const view = await loadAccess(session);

  return (
    <AdminI18nProvider locale={locale} messages={await pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={ADMIN_PATHS.data}
        active="data"
        title={t("admin.guests.nav.data")}
        intro={t("admin.guests.data.intro")}
        help="data"
      >
        <div className="flex flex-col gap-6">
          <Card as="section" aria-labelledby="export-heading">
            <h2 id="export-heading" className="flex items-center gap-2 text-2xl font-medium">
              <Icon icon={Download} />
              {t("admin.guests.data.export.title")}
            </h2>
            <p className="text-muted mt-2 max-w-prose">{t("admin.guests.data.export.intro")}</p>
            <div className="mt-4">
              <ExportForm action={appHref("/hoste/export", locale)} locale={locale} />
            </div>
          </Card>
          <DeleteSite
            graceDays={view.restore_days}
            redirectHref={appHref("/prihlaseni", locale)}
            remove={deleteSiteAction}
          />
        </div>
      </AdminFrame>
    </AdminI18nProvider>
  );
}
