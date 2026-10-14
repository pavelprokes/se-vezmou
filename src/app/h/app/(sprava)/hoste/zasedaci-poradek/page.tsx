import type { Metadata } from "next";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { loadSeating } from "@/admin/seating/server";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { SeatingPlanner } from "@/components/admin/seating/seating-planner";
import { getTranslator } from "@/i18n/load";
import { pick } from "@/site/i18n-text";
import { saveSeatingAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["admin.guests"]))(
      "admin.guests.seating.title",
    ),
  };
}

/**
 * Zasedací pořádek (fáze 2): předvolby rozložení stolů, plánek a usazení hostů, kteří potvrdili účast.
 * Plán se ukládá sám; tisk plánku a seznamů po stolech je na samostatné stránce.
 */
export default async function SeatingPage() {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin.guests"]);
  const data = await loadSeating(session);

  return (
    <AdminI18nProvider locale={locale} messages={await pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={ADMIN_PATHS.seating}
        active="guests"
        title={t("admin.guests.seating.title")}
        intro={t("admin.guests.seating.intro")}
        help="seating"
        wide
      >
        <SeatingPlanner
          initial={data.plan}
          rev={data.rev}
          people={data.people}
          events={data.events.map((event) => ({
            id: event.id,
            title: pick(event.title, locale, "cs") || "?",
          }))}
          printHref={appHref(ADMIN_PATHS.seatingPrint, locale)}
          save={saveSeatingAction}
        />
      </AdminFrame>
    </AdminI18nProvider>
  );
}
