import type { Metadata } from "next";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { loadGuests } from "@/admin/guests/server";
import { peekSite } from "@/admin/site/server";
import { siteOrigin } from "@/admin/site-href";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { PrintButton } from "@/components/admin/guests/print-button";
import { Card } from "@/components/ui/card";
import { QrCode } from "@/components/wizard/qr-code";
import { getTranslator } from "@/i18n/load";
import { invitePath } from "@/site/invite";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["admin.guests"]))("admin.guests.cards.title"),
  };
}

/**
 * Kartičky s QR osobních odkazů k tisku (do pozvánek): jedna na domácnost, všechny nebo jen skupina
 * (`?skupina=`). QR i adresa vedou na zveřejněný web, proto jen po zveřejnění. Tisk skryje navigaci.
 */
export default async function GuestCardsPage({ searchParams }: PageProps<"/h/app/hoste/karty">) {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin.guests"]);
  const { skupina } = await searchParams;
  const group = typeof skupina === "string" && skupina.trim() !== "" ? skupina : null;

  const [data, site] = await Promise.all([loadGuests(session), peekSite(session)]);
  const origin = site?.meta.status === "published" ? await siteOrigin(site.meta.slug) : null;
  const households = data.households.filter(
    (household) =>
      household.invite_code !== null && (group === null || household.tags.includes(group)),
  );

  return (
    <AdminFrame
      locale={locale}
      path={ADMIN_PATHS.guestCards}
      active="guests"
      title={group ? t("admin.guests.cards.titleGroup", { group }) : t("admin.guests.cards.title")}
      help="guests"
      wide
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 print:hidden">
          <p className="text-muted max-w-prose text-lg">{t("admin.guests.cards.intro")}</p>
          <div className="flex flex-wrap items-center gap-3">
            {origin && households.length > 0 ? (
              <PrintButton label={t("admin.guests.cards.print")} />
            ) : null}
            <a
              href={appHref(ADMIN_PATHS.guests, locale)}
              className="min-h-target text-pine inline-flex items-center px-3 underline underline-offset-4"
            >
              {t("admin.guests.editor.cancel")}
            </a>
          </div>
        </div>

        {!origin ? (
          <Card>
            <p className="text-lg">{t("admin.guests.cards.unpublished")}</p>
          </Card>
        ) : households.length === 0 ? (
          <Card>
            <p className="text-lg">{t("admin.guests.cards.empty")}</p>
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-2">
            {households.map((household) => {
              const names = household.guests.map((guest) => guest.display_name).join(", ");
              const heading = household.label.trim() || names;
              const url = `${origin}${invitePath(household.invite_code as string)}`;
              return (
                <li
                  key={household.id}
                  className="border-hairline flex break-inside-avoid items-center gap-4 rounded-2xl border p-4"
                >
                  <QrCode
                    payload={url}
                    label={t("admin.guests.cards.qrLabel", { name: heading })}
                    className="size-32 shrink-0"
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <h2 className="text-xl font-medium">{heading}</h2>
                    {household.label.trim() ? <p>{names}</p> : null}
                    <p className="text-muted font-mono text-sm break-all">{url}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AdminFrame>
  );
}
