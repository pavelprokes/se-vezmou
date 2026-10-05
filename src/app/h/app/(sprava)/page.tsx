import { CalendarClock, CircleCheck, Download, EyeOff, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { liveSite } from "@/admin/site-href";
import { isManaged, peekSite } from "@/admin/site/server";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { QuickNotice } from "@/components/admin/quick-notice";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { ShareLinks } from "@/components/share-links";
import { getTranslator } from "@/i18n/load";
import { formatDate } from "@/i18n/translator";
import { adminLifecycleUpcoming } from "@/lib/db/admin-guests";
import { quickNoticeAction } from "./web/actions";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["common", "admin"]))("admin.overview.title"),
  };
}

/**
 * Přehled „Můj web“ (FR-ADM-1 a FR-ADM-3): stav webu (výběr svatby je na `/svatby`, odkaz v hlavičce),
 * odkazy do správy a rychlá změna (pruh nahoře na webu). Bez platné relace přesměruje na přihlášení.
 */
export default async function OverviewPage() {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["common", "admin"]);

  const [loaded, upcoming] = await Promise.all([
    peekSite(session),
    // upozornění je doplněk: výpadek ho jen skryje, přehled se vykreslí
    adminLifecycleUpcoming(session).catch(() => []),
  ]);
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
    <AdminI18nProvider locale={locale} messages={await pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={ADMIN_PATHS.overview}
        active="overview"
        title={t("admin.overview.title")}
        intro={t("admin.overview.intro", { names })}
        help="overview"
      >
        <div className="flex flex-col gap-6">
          {upcoming.length > 0 ? (
            <Card as="section" aria-labelledby="upcoming-heading" tone="linen">
              <h2 id="upcoming-heading" className="flex items-center gap-2 text-2xl font-medium">
                <Icon icon={CalendarClock} />
                {t("admin.overview.upcoming.title")}
              </h2>
              <ul className="mt-3 flex flex-col gap-1" data-testid="overview-upcoming">
                {upcoming.map((event) => (
                  <li key={event.kind}>
                    {t(`admin.overview.upcoming.${event.kind}`, {
                      date: formatDate(new Date(event.event_at), locale, {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        timeZone: doc.wedding.timezone,
                      }),
                    })}
                  </li>
                ))}
              </ul>
              <p className="text-muted mt-2 max-w-prose">{t("admin.overview.upcoming.body")}</p>
              <p className="mt-4">
                <a href={appHref(ADMIN_PATHS.data, locale)} className={buttonVariants()}>
                  <Icon icon={Download} size={18} />
                  {t("admin.overview.upcoming.export")}
                </a>
              </p>
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
            {site && published ? (
              <div className="mt-5 flex flex-col gap-3">
                <h3 className="text-lg font-medium">{t("admin.overview.share.title")}</h3>
                <p className="text-muted text-sm">{t("admin.overview.share.body")}</p>
                <ShareLinks
                  labels={{
                    whatsapp: t("admin.overview.share.whatsapp"),
                    sms: t("admin.overview.share.sms"),
                    email: t("admin.overview.share.email"),
                    native: t("admin.overview.share.native"),
                    subject: t("admin.overview.share.subject"),
                    message: t("admin.overview.share.message", { url: site.url }),
                  }}
                />
              </div>
            ) : null}
          </Card>

          <Card as="section" aria-labelledby="quick-heading">
            <h2 id="quick-heading" className="mb-4 text-2xl font-medium">
              {t("admin.overview.quick")}
            </h2>
            {managed ? (
              <QuickNotice
                initial={{ notice: meta.quickNotice, enabled: meta.quickNoticeEnabled }}
                locales={doc.wedding.locales}
                weddingDate={{ startsOn: doc.wedding.startsOn, endsOn: doc.wedding.endsOn }}
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
