import { CircleCheck, EyeOff, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { liveSite } from "@/admin/site-href";
import { isManaged, listMyWeddings, peekSite } from "@/admin/site/server";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { QuickNotice } from "@/components/admin/quick-notice";
import { WeddingPicker } from "@/components/admin/wedding-picker";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { createTranslator } from "@/i18n/translator";
import { quickNoticeAction } from "./web/actions";
import { switchWeddingAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: createTranslator(await getUiLocale())("admin.overview.title") };
}

/**
 * Přehled „Můj web“ (FR-ADM-1 a FR-ADM-3): stav webu, výběr svatby, když jich správce má víc,
 * odkazy do správy a rychlá změna (pruh nahoře na webu). Bez platné relace přesměruje na přihlášení.
 */
export default async function OverviewPage() {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = createTranslator(locale);

  const [loaded, weddings] = await Promise.all([peekSite(session), listMyWeddings(session)]);
  if (!loaded) notFound();
  const { doc, meta } = loaded;

  const managed = isManaged(meta);
  const published = meta.status === "published";
  const site = await liveSite(meta.slug, doc.wedding.defaultLocale);
  const names = `${doc.wedding.partnerA} ${t("common.and")} ${doc.wedding.partnerB}`;

  const statusText = published
    ? meta.hasUnpublishedChanges
      ? t("admin.overview.status.changed", { version: meta.publishedVersionNo ?? 0 })
      : t("admin.overview.status.published", { version: meta.publishedVersionNo ?? 0 })
    : managed
      ? t("admin.overview.status.unpublished")
      : t("admin.overview.status.draft");

  return (
    <AdminI18nProvider locale={locale} messages={pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={ADMIN_PATHS.overview}
        active="overview"
        title={t("admin.overview.title")}
        intro={t("admin.overview.intro", { names })}
        help="overview"
      >
        <div className="flex flex-col gap-6">
          {weddings.length > 1 ? (
            <Card as="section" aria-labelledby="picker-heading">
              <h2 id="picker-heading" className="text-2xl font-medium">
                {t("admin.picker.title")}
              </h2>
              <p className="text-muted mt-2 mb-4">{t("admin.picker.intro")}</p>
              <WeddingPicker
                action={switchWeddingAction}
                weddings={weddings.map((wedding) => ({
                  weddingId: wedding.weddingId,
                  names: `${wedding.partnerAName} ${t("common.and")} ${wedding.partnerBName}`,
                  site: wedding.slug,
                  isCurrent: wedding.isCurrent,
                }))}
              />
            </Card>
          ) : null}

          <Card as="section" aria-labelledby="status-heading">
            <h2 id="status-heading" className="text-2xl font-medium">
              {t("admin.nav.site")}
            </h2>
            <p className="mt-3 flex items-center gap-2 text-lg" data-testid="overview-status">
              <Icon icon={published ? CircleCheck : EyeOff} />
              <span>{statusText}</span>
            </p>
            <p className="text-muted mt-2">
              {site
                ? t("admin.overview.address", { site: site.host })
                : t("admin.overview.noAddress")}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {managed ? (
                <a href={appHref(ADMIN_PATHS.site, locale)} className={buttonVariants()}>
                  <Icon icon={Pencil} size={18} />
                  {t("admin.overview.edit")}
                </a>
              ) : (
                <a href={appHref("/vytvorit", locale)} className={buttonVariants()}>
                  {t("admin.overview.finish")}
                </a>
              )}
              {site && published ? (
                <a
                  href={site.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: "secondary" })}
                >
                  {t("admin.overview.view")}
                  <span className="sr-only">{t("admin.common.newTab")}</span>
                </a>
              ) : null}
              {managed ? (
                <a
                  href={appHref(ADMIN_PATHS.history, locale)}
                  className={buttonVariants({ variant: "secondary" })}
                >
                  {t("admin.overview.history")}
                </a>
              ) : null}
            </div>
          </Card>

          <Card as="section" aria-labelledby="quick-heading">
            <h2 id="quick-heading" className="mb-4 text-2xl font-medium">
              {t("admin.overview.quick")}
            </h2>
            {managed ? (
              <QuickNotice
                initial={{ notice: meta.quickNotice, enabled: meta.quickNoticeEnabled }}
                locales={doc.wedding.locales}
                action={quickNoticeAction}
                published={published}
              />
            ) : (
              <p className="text-muted">{t("admin.overview.quickDraft")}</p>
            )}
          </Card>
        </div>
      </AdminFrame>
    </AdminI18nProvider>
  );
}
