import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { loadSite } from "@/admin/site/server";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { HistoryList } from "@/components/admin/history-list";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { buttonVariants } from "@/components/ui/button";
import { intlLocale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { restoreVersionAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator(await getUiLocale(), ["admin"]))("admin.history.title") };
}

/** Historie verzí webu (FR-ADM-2): zveřejněné verze, body pro vrácení a vrácení verze jako konceptu. */
export default async function HistoryPage() {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin"]);

  const loaded = await loadSite(session);
  if (!loaded) notFound();
  const { doc, versions } = loaded;
  // Čas se formátuje na serveru v pásmu svatby, aby se server a prohlížeč nikdy nerozešly.
  const format = new Intl.DateTimeFormat(intlLocale[locale], {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: doc.wedding.timezone,
  });

  return (
    <AdminI18nProvider locale={locale} messages={await pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={ADMIN_PATHS.history}
        active="history"
        title={t("admin.history.title")}
        intro={t("admin.history.intro")}
        help="history"
      >
        <HistoryList
          editorHref={appHref(ADMIN_PATHS.site, locale)}
          restore={restoreVersionAction}
          items={versions.map((version) => ({
            id: version.id,
            versionNo: version.versionNo,
            kind: version.kind,
            note: version.note,
            when: format.format(new Date(version.createdAt)),
            isPublished: version.isPublished,
            byMe: version.byMe,
          }))}
        />
        <p className="mt-6">
          <a
            href={appHref(ADMIN_PATHS.site, locale)}
            className={buttonVariants({ variant: "secondary" })}
          >
            {t("admin.history.back")}
          </a>
        </p>
      </AdminFrame>
    </AdminI18nProvider>
  );
}
