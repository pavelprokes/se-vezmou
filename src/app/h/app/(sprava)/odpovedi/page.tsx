import { CircleCheck, CircleHelp, CircleX, Settings } from "lucide-react";
import type { Metadata } from "next";
import { ADMIN_PATHS, appHref, responsePath } from "@/admin/paths";
import { loadGuests, loadRsvpSettings } from "@/admin/guests/server";
import { rsvpWindow } from "@/admin/guests/types";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { intlLocale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { getRsvpOverview } from "@/lib/rsvp/admin";
import { householdStatus } from "@/lib/rsvp/types";
import { pick } from "@/site/i18n-text";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["admin.guests"]))(
      "admin.guests.nav.responses",
    ),
  };
}

const WINDOW = {
  open: { icon: CircleCheck, key: "admin.guests.rsvp.window.open" },
  scheduled: { icon: CircleHelp, key: "admin.guests.rsvp.window.scheduled" },
  closed: { icon: CircleX, key: "admin.guests.rsvp.window.closed" },
} as const;

const STATUS = {
  no_response: { icon: CircleHelp, key: "admin.guests.list.status.no_response" },
  attending: { icon: CircleCheck, key: "admin.guests.list.status.attending" },
  declined: { icon: CircleX, key: "admin.guests.list.status.declined" },
} as const;

/**
 * Přehled odpovědí (FR-ADM-5): kolik domácností odpovědělo, kolik lidí přijde na která událost,
 * kdo ještě neodpověděl (s ručním zápisem po telefonu) a hosté mimo seznam. Počty jsou po hlavách.
 * Vždy slovy a ikonou, ne jen barvou.
 */
export default async function ResponsesPage({ searchParams }: PageProps<"/h/app/odpovedi">) {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin.guests"]);
  const params = await searchParams;
  const [overview, guests, settings] = await Promise.all([
    getRsvpOverview(session),
    loadGuests(session),
    loadRsvpSettings(session),
  ]);

  const windowState = rsvpWindow(settings.settings.opens_at, settings.settings.closes_at);
  const day = new Intl.DateTimeFormat(intlLocale[locale], {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: settings.timezone,
  });
  const pending = guests.households.filter(
    (household) => householdStatus(household) === "no_response",
  );
  const answered = guests.households.filter(
    (household) => householdStatus(household) !== "no_response",
  );
  const title = (household: (typeof guests.households)[number]) =>
    household.label.trim() || household.guests.map((guest) => guest.display_name).join(", ");
  const eventTitle = (value: Parameters<typeof pick>[0]) =>
    pick(value, locale, settings.default_locale) || "?";

  return (
    <AdminFrame
      locale={locale}
      path={ADMIN_PATHS.responses}
      active="responses"
      title={t("admin.guests.nav.responses")}
      intro={t("admin.guests.responses.intro")}
      help="responses"
      wide
    >
      <div className="flex flex-col gap-6">
        {params.ulozeno ? (
          <p role="status" className="text-ink flex items-center gap-2 font-medium">
            <Icon icon={CircleCheck} />
            {t("admin.guests.responses.saved")}
          </p>
        ) : null}

        <Card as="section" aria-labelledby="window-heading">
          <h2 id="window-heading" className="text-2xl font-medium">
            {t("admin.guests.rsvp.window.title")}
          </h2>
          <p className="mt-3 flex items-center gap-2 text-lg font-medium" data-testid="rsvp-window">
            <Icon icon={WINDOW[windowState].icon} />
            {t(WINDOW[windowState].key)}
          </p>
          <p className="text-muted mt-2">
            {settings.settings.opens_at
              ? t("admin.guests.responses.opens", {
                  when: day.format(new Date(settings.settings.opens_at)),
                })
              : t("admin.guests.responses.opensNow")}{" "}
            {settings.settings.closes_at
              ? t("admin.guests.responses.closes", {
                  when: day.format(new Date(settings.settings.closes_at)),
                })
              : t("admin.guests.responses.closesNever")}
          </p>
          <p className="mt-4">
            <a
              href={appHref(ADMIN_PATHS.rsvpSettings, locale)}
              className={buttonVariants({ variant: "secondary" })}
            >
              <Icon icon={Settings} size={18} />
              {t("admin.guests.responses.settings")}
            </a>
          </p>
        </Card>

        <Card as="section" aria-labelledby="totals-heading">
          <h2 id="totals-heading" className="text-2xl font-medium">
            {t("admin.guests.responses.totals")}
          </h2>
          <p className="mt-3 text-lg" data-testid="households-total">
            {t("admin.guests.responses.households", {
              answered: overview.households.answered,
              total: overview.households.total,
            })}
          </p>
          {overview.events.length > 0 ? (
            <div
              role="region"
              aria-label={t("admin.guests.responses.eventsTable")}
              tabIndex={0}
              className="border-hairline mt-4 overflow-x-auto rounded-2xl border"
            >
              <table
                className="w-full min-w-[34rem] border-collapse text-left"
                data-testid="event-totals"
              >
                <caption className="sr-only">{t("admin.guests.responses.eventsTable")}</caption>
                <thead className="bg-linen">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      {t("admin.guests.responses.col.event")}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      {t("admin.guests.responses.col.invited")}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      {t("admin.guests.responses.col.attending")}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      {t("admin.guests.responses.col.declined")}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      {t("admin.guests.responses.col.pending")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {overview.events.map((event) => (
                    <tr key={event.event_id} className="border-hairline border-t">
                      <th scope="row" className="px-3 py-2 font-medium">
                        {eventTitle(event.title)}
                      </th>
                      <td className="px-3 py-2">{event.invited}</td>
                      <td className="px-3 py-2">
                        {event.attending + event.attending_extra}
                        {event.attending_extra > 0
                          ? ` ${t("admin.guests.responses.extra", { n: event.attending_extra })}`
                          : ""}
                      </td>
                      <td className="px-3 py-2">{event.declined}</td>
                      <td className="px-3 py-2">{event.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted mt-3">{t("admin.guests.responses.noEvents")}</p>
          )}
        </Card>

        <Card as="section" aria-labelledby="pending-heading">
          <h2 id="pending-heading" className="text-2xl font-medium">
            {t("admin.guests.responses.pending", { n: pending.length })}
          </h2>
          {pending.length === 0 ? (
            <p className="text-muted mt-3">{t("admin.guests.responses.nonePending")}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {pending.map((household) => (
                <li
                  key={household.id}
                  className="border-hairline bg-parchment flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
                >
                  <p className="font-medium">{title(household)}</p>
                  <a
                    href={appHref(responsePath(household.id), locale)}
                    className={buttonVariants({ variant: "secondary" })}
                    aria-label={t("admin.guests.list.enterLabel", { name: title(household) })}
                  >
                    {t("admin.guests.list.enter")}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card as="section" aria-labelledby="answered-heading">
          <h2 id="answered-heading" className="text-2xl font-medium">
            {t("admin.guests.responses.answered", { n: answered.length })}
          </h2>
          {answered.length === 0 ? (
            <p className="text-muted mt-3">{t("admin.guests.responses.noneAnswered")}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {answered.map((household) => {
                const status = householdStatus(household);
                return (
                  <li
                    key={household.id}
                    className="border-hairline bg-parchment flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
                  >
                    <div>
                      <p className="font-medium">{title(household)}</p>
                      <p className="flex items-center gap-2">
                        <Icon icon={STATUS[status].icon} size={18} />
                        {t(STATUS[status].key)}
                        {household.response
                          ? ` · ${
                              household.response.entered_by === "admin"
                                ? t("admin.guests.responses.byAdmin")
                                : t("admin.guests.responses.byGuest")
                            } · ${day.format(new Date(household.response.last_edited_at))}`
                          : ""}
                      </p>
                    </div>
                    <a
                      href={appHref(responsePath(household.id), locale)}
                      className={buttonVariants({ variant: "text" })}
                      aria-label={t("admin.guests.responses.editLabel", { name: title(household) })}
                    >
                      {t("admin.guests.responses.edit")}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {guests.unlisted.length > 0 ? (
          <Card as="section" aria-labelledby="unlisted-heading">
            <h2 id="unlisted-heading" className="text-2xl font-medium">
              {t("admin.guests.responses.unlisted", { n: guests.unlisted.length })}
            </h2>
            <p className="text-muted mt-2">{t("admin.guests.responses.unlistedHint")}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {guests.unlisted.map((response) => (
                <li key={response.id}>
                  <span className="font-medium">
                    {response.people.map((person) => person.person_name).join(", ")}
                  </span>
                  {` · ${day.format(new Date(response.submitted_at))}`}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </AdminFrame>
  );
}
