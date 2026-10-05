import { Download, FileSpreadsheet, IdCard } from "lucide-react";
import type { Metadata } from "next";
import { ADMIN_PATHS, appHref, householdPath, responsePath } from "@/admin/paths";
import { loadGuests } from "@/admin/guests/server";
import { peekSite } from "@/admin/site/server";
import { siteOrigin } from "@/admin/site-href";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { GuestList } from "@/components/admin/guests/guest-list";
import { ExportForm } from "@/components/admin/guests/export-form";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { getTranslator } from "@/i18n/load";
import { bulkInviteAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["admin.guests"]))("admin.guests.nav.guests"),
  };
}

/**
 * Hosté a domácnosti (FR-ADM-4): seznam s hledáním, ruční zápis a úprava, import z Excelu a CSV,
 * export pro tisk a pro odnesení dat, hromadné pozvání na události.
 */
export default async function GuestsPage({ searchParams }: PageProps<"/h/app/hoste">) {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin.guests"]);
  const params = await searchParams;
  const [data, site] = await Promise.all([loadGuests(session), peekSite(session)]);
  // osobní odkazy vedou na zveřejněný web; před zveřejněním by končily na 404
  const inviteOrigin = site?.meta.status === "published" ? await siteOrigin(site.meta.slug) : null;
  const flag = params.ulozeno
    ? "saved"
    : params.smazano
      ? "deleted"
      : params.odkaz
        ? "invite"
        : null;

  return (
    <AdminI18nProvider locale={locale} messages={await pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={ADMIN_PATHS.guests}
        active="guests"
        title={t("admin.guests.nav.guests")}
        intro={t("admin.guests.list.intro")}
        help="guests"
        wide
      >
        <div className="flex flex-col gap-6">
          <GuestList
            data={data}
            locale={locale}
            saved={flag}
            hrefs={{
              add: appHref(householdPath("nova"), locale),
              householdPrefix: appHref(householdPath(""), locale),
              responsePrefix: appHref(responsePath(""), locale),
              cards: appHref(ADMIN_PATHS.guestCards, locale),
            }}
            inviteOrigin={inviteOrigin}
            actions={{ bulkInvite: bulkInviteAction }}
          />

          <Card as="section" aria-labelledby="import-heading">
            <h2 id="import-heading" className="text-2xl font-medium">
              {t("admin.guests.list.importTitle")}
            </h2>
            <p className="text-muted mt-2 max-w-prose">{t("admin.guests.list.importIntro")}</p>
            <p className="mt-4">
              <a
                href={appHref(ADMIN_PATHS.guestsImport, locale)}
                className={buttonVariants({ variant: "secondary" })}
              >
                <Icon icon={FileSpreadsheet} size={18} />
                {t("admin.guests.list.importLink")}
              </a>
            </p>
          </Card>

          <Card as="section" aria-labelledby="name-cards-heading">
            <h2 id="name-cards-heading" className="text-2xl font-medium">
              {t("admin.guests.list.nameCardsTitle")}
            </h2>
            <p className="text-muted mt-2 max-w-prose">{t("admin.guests.list.nameCardsIntro")}</p>
            <p className="mt-4">
              <a
                href={appHref(ADMIN_PATHS.nameCards, locale)}
                className={buttonVariants({ variant: "secondary" })}
              >
                <Icon icon={IdCard} size={18} />
                {t("admin.guests.list.nameCardsLink")}
              </a>
            </p>
          </Card>

          <Card as="section" aria-labelledby="export-heading">
            <h2 id="export-heading" className="flex items-center gap-2 text-2xl font-medium">
              <Icon icon={Download} />
              {t("admin.guests.list.exportTitle")}
            </h2>
            <p className="text-muted mt-2 max-w-prose">{t("admin.guests.list.exportIntro")}</p>
            <div className="mt-4">
              <ExportForm action={appHref("/hoste/export", locale)} locale={locale} />
            </div>
          </Card>
        </div>
      </AdminFrame>
    </AdminI18nProvider>
  );
}
