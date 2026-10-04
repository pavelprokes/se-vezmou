import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { loadGuests } from "@/admin/guests/server";
import { weddingTags } from "@/admin/guests/tags";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { HouseholdEditor } from "@/components/admin/guests/household-editor";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { getTranslator } from "@/i18n/load";
import { pick } from "@/site/i18n-text";
import { deleteHouseholdAction, saveHouseholdAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["admin.guests"]))(
      "admin.guests.editor.title",
    ),
  };
}

/** Nová domácnost (`nova`) nebo úprava existující: hosté, děti s věkem a pozvání na události. */
export default async function HouseholdPage({ params }: PageProps<"/h/app/hoste/domacnost/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin.guests"]);
  const data = await loadGuests(session);

  const isNew = id === "nova";
  if (!isNew && !z.uuid().safeParse(id).success) notFound();
  const household = isNew ? null : data.households.find((candidate) => candidate.id === id);
  if (!isNew && !household) notFound();

  const events = data.events.map((event) => ({
    id: event.id,
    title: pick(event.title, locale, "cs") || "?",
  }));
  const allEventIds = data.events.filter((event) => event.rsvp_enabled).map((event) => event.id);

  return (
    <AdminI18nProvider locale={locale} messages={await pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={isNew ? "/hoste/domacnost/nova" : `/hoste/domacnost/${id}`}
        active="guests"
        title={isNew ? t("admin.guests.editor.titleNew") : t("admin.guests.editor.title")}
        help="guests"
      >
        <HouseholdEditor
          householdId={household?.id ?? null}
          initial={{
            label: household?.label ?? "",
            tags: household?.tags ?? [],
            note: household?.invited_note ?? "",
            guests: household
              ? household.guests.map((guest) => ({
                  id: guest.id,
                  name: guest.display_name,
                  isChild: guest.is_child,
                  age: guest.age === null ? "" : String(guest.age),
                  eventIds: guest.invited_event_ids,
                }))
              : [{ id: null, name: "", isChild: false, age: "", eventIds: allEventIds }],
          }}
          knownTags={weddingTags(data.households)}
          events={events}
          answered={Boolean(household?.response)}
          listHref={appHref(ADMIN_PATHS.guests, locale)}
          eventsHref={appHref(ADMIN_PATHS.site, locale)}
          actions={{ save: saveHouseholdAction, remove: deleteHouseholdAction }}
        />
      </AdminFrame>
    </AdminI18nProvider>
  );
}
