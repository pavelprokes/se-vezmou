import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ADMIN_PATHS, appHref, responsePath } from "@/admin/paths";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { ResponseEntry } from "@/components/admin/guests/response-entry";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { createTranslator } from "@/i18n/translator";
import { getHouseholdForEntry } from "@/lib/rsvp/admin";
import { buildListedModel } from "@/lib/rsvp/form";
import { enterResponseAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: createTranslator(await getUiLocale())("admin.guests.entry.title") };
}

/** Ruční zápis odpovědi domácnosti (host odpověděl telefonem, FR-ADM-5). */
export default async function EntryPage({ params }: PageProps<"/h/app/odpovedi/[householdId]">) {
  const { householdId } = await params;
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = createTranslator(locale);
  if (!z.uuid().safeParse(householdId).success) notFound();

  const view = await getHouseholdForEntry(session, householdId);
  if (!view) notFound();
  const model = buildListedModel(view, locale);
  const names = model.guests.map((guest) => guest.name).join(", ");

  return (
    <AdminI18nProvider locale={locale} messages={pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={responsePath(householdId)}
        active="responses"
        title={t("admin.guests.entry.title")}
        intro={t("admin.guests.entry.intro", { names })}
        help="responses"
      >
        <ResponseEntry
          householdName={names}
          model={model}
          action={enterResponseAction.bind(null, householdId)}
          listHref={appHref(ADMIN_PATHS.responses, locale)}
        />
      </AdminFrame>
    </AdminI18nProvider>
  );
}
