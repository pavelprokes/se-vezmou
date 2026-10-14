import type { Metadata } from "next";
import { ADMIN_PATHS } from "@/admin/paths";
import { listVendors, loadNotes } from "@/admin/notes/server";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { PlanningNotes } from "@/components/admin/notes/planning-notes";
import { getTranslator } from "@/i18n/load";
import { deleteVendorAction, saveNotesAction, saveVendorAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslator(await getUiLocale(), ["admin"]))("admin.notes.title") };
}

/** Soukromé poznámky a kontakty na dodavatele (fáze 2): jen pro správce, na webu se nezobrazují. */
export default async function NotesPage() {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin"]);
  const [vendors, notes] = await Promise.all([listVendors(session), loadNotes(session)]);

  return (
    <AdminI18nProvider locale={locale} messages={await pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={ADMIN_PATHS.notes}
        active="notes"
        title={t("admin.notes.title")}
        intro={t("admin.notes.intro")}
        help="notes"
        wide
      >
        <PlanningNotes
          vendors={vendors}
          notes={notes}
          saveVendor={saveVendorAction}
          deleteVendor={deleteVendorAction}
          saveNotes={saveNotesAction}
        />
      </AdminFrame>
    </AdminI18nProvider>
  );
}
