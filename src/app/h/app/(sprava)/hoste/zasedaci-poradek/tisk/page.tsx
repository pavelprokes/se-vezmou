import type { Metadata } from "next";
import { ADMIN_PATHS, appHref } from "@/admin/paths";
import { occupancy } from "@/admin/seating/layout";
import { loadSeating, seatedPeople } from "@/admin/seating/server";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { PrintButton } from "@/components/admin/guests/print-button";
import { SeatingMap } from "@/components/admin/seating/seating-map";
import { intlLocale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["admin.guests"]))(
      "admin.guests.seating.printTitle",
    ),
  };
}

/**
 * Tisk zasedacího pořádku: plánek sálu, seznam po stolech pro obsluhu a abecední seznam „kdo kde sedí“
 * ke vchodu. Navigace se při tisku skryje, každá část začíná na nové stránce.
 */
export default async function SeatingPrintPage() {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin.guests"]);
  const data = await loadSeating(session);
  const { plan } = data;
  const people = new Map(data.people.map((p) => [p.key, p]));
  const seated = seatedPeople(data, plan.eventId);
  const unseated = seated.filter((p) => !plan.assignments[p.key]);
  const tableLabel = new Map(plan.tables.map((table) => [table.id, table.label]));
  const collator = new Intl.Collator(intlLocale[locale]);
  const alphabetical = seated
    .filter((p) => plan.assignments[p.key])
    .sort((a, b) => collator.compare(a.name, b.name));

  return (
    <AdminFrame
      locale={locale}
      path={ADMIN_PATHS.seatingPrint}
      active="guests"
      title={t("admin.guests.seating.printTitle")}
      help="seating"
      wide
    >
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          {plan.tables.length > 0 ? (
            <PrintButton label={t("admin.guests.seating.printNow")} />
          ) : null}
          <a
            href={appHref(ADMIN_PATHS.seating, locale)}
            className="min-h-target text-pine inline-flex items-center px-3 underline underline-offset-4"
          >
            {t("admin.guests.seating.back")}
          </a>
        </div>
        {plan.tables.length === 0 ? (
          <p className="text-lg">{t("admin.guests.seating.map.empty")}</p>
        ) : (
          <>
            <section aria-labelledby="print-map" className="break-after-page">
              <h2 id="print-map" className="text-2xl font-medium">
                {t("admin.guests.seating.printMap")}
              </h2>
              <SeatingMap
                plan={plan}
                label={t("admin.guests.seating.map.label", {
                  tables: plan.tables.length,
                  seats: plan.tables.reduce((sum, table) => sum + table.seats, 0),
                  taken: Object.keys(plan.assignments).length,
                })}
                className="text-ink mt-4 h-auto max-h-[60rem] w-full"
              />
            </section>

            <section aria-labelledby="print-tables" className="break-after-page">
              <h2 id="print-tables" className="text-2xl font-medium">
                {t("admin.guests.seating.printTables")}
              </h2>
              <div className="mt-4 grid gap-6 sm:grid-cols-2 print:grid-cols-2">
                {plan.tables.map((table) => {
                  const taken = [...occupancy(plan, table.id)].sort(([a], [b]) => a - b);
                  return (
                    <div key={table.id} className="break-inside-avoid">
                      <h3 className="text-lg font-medium">
                        {t("admin.guests.seating.tables.heading", {
                          table: table.label,
                          taken: taken.length,
                          seats: table.seats,
                        })}
                      </h3>
                      <ol className="mt-1">
                        {taken.map(([seatNo, key]) => {
                          const person = people.get(key);
                          return (
                            <li key={key}>
                              {t("admin.guests.seating.tables.seat", {
                                seat: seatNo,
                                name: person?.name ?? "?",
                              })}
                              {person?.isChild ? ` (${t("admin.guests.seating.child")})` : ""}
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="print-names">
              <h2 id="print-names" className="text-2xl font-medium">
                {t("admin.guests.seating.printNames")}
              </h2>
              <table className="mt-4 w-full max-w-2xl border-collapse text-left">
                <caption className="sr-only">{t("admin.guests.seating.printNames")}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="py-1 pr-4">
                      {t("admin.guests.seating.col.name")}
                    </th>
                    <th scope="col" className="py-1">
                      {t("admin.guests.seating.col.table")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {alphabetical.map((person) => (
                    <tr key={person.key} className="border-hairline border-t">
                      <th scope="row" className="py-1 pr-4 font-normal">
                        {person.name}
                      </th>
                      <td className="py-1">{tableLabel.get(plan.assignments[person.key].table)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {unseated.length > 0 ? (
                <p className="mt-4 font-medium print:hidden">
                  {t("admin.guests.seating.printUnseated", {
                    n: unseated.length,
                    names: unseated.map((p) => p.name).join(", "),
                  })}
                </p>
              ) : null}
            </section>
          </>
        )}
      </div>
    </AdminFrame>
  );
}
