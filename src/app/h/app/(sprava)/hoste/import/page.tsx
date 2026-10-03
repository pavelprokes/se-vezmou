import type { Metadata } from "next";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { loadGuests } from "@/admin/guests/server";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { ImportFlow } from "@/components/admin/guests/import-flow";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { getTranslator } from "@/i18n/load";
import { pick } from "@/site/i18n-text";
import { commitImportAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["admin.guests"]))(
      "admin.guests.import.title",
    ),
  };
}

/** Import seznamu hostů z Excelu a CSV (FR-ADM-4): výběr souboru, náhled s ověřením, potvrzení. */
export default async function ImportPage() {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin.guests"]);
  const data = await loadGuests(session);

  return (
    <AdminI18nProvider locale={locale} messages={await pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={ADMIN_PATHS.guestsImport}
        active="guests"
        title={t("admin.guests.import.title")}
        intro={t("admin.guests.import.intro")}
        help="import"
        wide
      >
        <ImportFlow
          events={data.events
            .filter((event) => event.rsvp_enabled)
            .map((event) => ({ id: event.id, title: pick(event.title, locale, "cs") || "?" }))}
          previewUrl="/hoste/import/nahled"
          templateUrl={appHref("/hoste/import/vzor", locale)}
          listHref={appHref(ADMIN_PATHS.guests, locale)}
          commit={commitImportAction}
        />
      </AdminFrame>
    </AdminI18nProvider>
  );
}
