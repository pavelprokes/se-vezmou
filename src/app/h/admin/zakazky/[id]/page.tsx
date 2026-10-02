import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { currentHostConfig } from "@/auth/app-origin";
import { getHost } from "@/auth/request";
import { Card } from "@/components/ui/card";
import { createTranslator } from "@/i18n/translator";
import { WEDDING_STATUSES } from "@/lib/db/types";
import { coupleNames, formatDay, formatMoment } from "@/ops/format";
import {
  ACTOR_KEYS,
  LOCALE_KEYS,
  SLUG_STATE_KEYS,
  STATUS_KEYS,
  TEMPLATE_KEYS,
  label,
} from "@/ops/labels";
import { loadWeddingDetail } from "@/ops/data";
import { can } from "@/ops/roles";
import { requireOperator } from "@/ops/session";
import { ResultBanner } from "@/ops/ui/result-banner";
import { siteOriginForAdminHost } from "@/ops/urls";
import {
  ExtendForm,
  GuestDataForm,
  LoginLinkForm,
  NoteForm,
  RestoreForm,
  SlugForm,
  StatusForm,
} from "@/ops/ui/wedding-forms";
import { OpsShell, SectionTitle, TableRegion, tableClass, tdClass, thClass } from "@/ops/ui/shell";

const t = createTranslator("cs");

export async function generateMetadata({
  params,
}: PageProps<"/h/admin/zakazky/[id]">): Promise<Metadata> {
  const session = await requireOperator("view");
  const { id } = await params;
  const detail = z.uuid().safeParse(id).success
    ? await loadWeddingDetail(session.operatorId, id)
    : null;
  return {
    title: detail
      ? t("ops.detail.title", {
          names: coupleNames(detail.wedding.partner_a_name, detail.wedding.partner_b_name),
        })
      : t("ops.weddings.title"),
  };
}

/** Všechna chybová hlášení formulářů zásahů (klíč = `state.error`). */
function errorTexts(): Record<string, string> {
  return {
    forbidden: t("ops.error.forbidden"),
    session: t("ops.error.session"),
    origin: t("ops.error.origin"),
    reason: t("ops.error.reason"),
    notFound: t("ops.error.notFound"),
    slugUnavailable: t("ops.error.slugUnavailable"),
    invalidSlug: t("ops.error.invalidSlug"),
    notExtension: t("ops.error.notExtension"),
    datePast: t("ops.error.datePast"),
    invalidDate: t("ops.error.invalidDate"),
    notRestorable: t("ops.error.notRestorable"),
    cannotPublish: t("ops.error.cannotPublish"),
    useRestore: t("ops.error.useRestore"),
    invalidNote: t("ops.error.invalidNote"),
    invalidStatus: t("ops.error.invalidStatus"),
    invalidKind: t("ops.error.invalidKind"),
    noAdmin: t("ops.error.noAdmin"),
    limited: t("ops.error.limited"),
    weddingBlocked: t("ops.error.weddingBlocked"),
    generic: t("ops.error.generic"),
  };
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="border-hairline border-b py-2 sm:grid sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-muted font-medium">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Hlášení o provedeném zásahu (`?vysledek=status`): po zásahu se stránka načte znovu a hlášení nese adresa. */
const RESULT_KEYS = {
  status: "ops.success.status",
  slug: "ops.success.slug",
  extend: "ops.success.extend",
  restore: "ops.success.restore",
  link: "ops.success.link",
  note: "ops.success.note",
} as const;

export default async function WeddingDetailPage({
  params,
  searchParams,
}: PageProps<"/h/admin/zakazky/[id]">) {
  const session = await requireOperator("view");
  const { id } = await params;
  const result = (await searchParams).vysledek;
  const resultKey =
    typeof result === "string" && result in RESULT_KEYS
      ? RESULT_KEYS[result as keyof typeof RESULT_KEYS]
      : null;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await loadWeddingDetail(session.operatorId, id);
  if (!detail) notFound();

  const w = detail.wedding;
  const none = t("ops.none");
  const names = coupleNames(w.partner_a_name, w.partner_b_name);
  const status = w.status;
  const errors = errorTexts();
  const activeAdmins = detail.admins.filter((a) => !a.removed_at);
  const deleted = status === "deleted";
  const restorable = w.restorable;

  const siteUrl =
    w.slug && status === "published"
      ? siteOriginForAdminHost(w.slug, await getHost(), currentHostConfig())
      : null;

  // Změna stavu: podpora smí jen zablokovat; majitel cokoli kromě současného stavu (smazaný se vrací obnovením).
  const statusOptions = deleted
    ? []
    : can(session.role, "set_status")
      ? WEDDING_STATUSES.filter((s) => s !== status).map((s) => ({
          value: s,
          label: label(t, STATUS_KEYS, s),
        }))
      : status === "blocked"
        ? []
        : [{ value: "blocked", label: label(t, STATUS_KEYS, "blocked") }];

  const reason = { reason: t("ops.action.reason.label"), reasonHint: t("ops.action.reason.hint") };

  return (
    <OpsShell session={session} current="weddings" title={t("ops.detail.title", { names })}>
      {resultKey ? <ResultBanner>{t(resultKey)}</ResultBanner> : null}
      <p className="mb-6">
        <a
          href="/zakazky"
          className="text-pine inline-flex min-h-[2.75rem] items-center underline underline-offset-4"
        >
          {t("ops.detail.back")}
        </a>
      </p>

      <div className="grid gap-10">
        <section aria-labelledby="d-summary">
          <SectionTitle id="d-summary">{t("ops.detail.summary.title")}</SectionTitle>
          <dl>
            <Row term={t("ops.detail.field.names")}>{names}</Row>
            <Row term={t("ops.detail.field.slug")}>{w.slug ?? t("ops.weddings.noSlug")}</Row>
            <Row term={t("ops.detail.field.status")}>{label(t, STATUS_KEYS, status)}</Row>
            {detail.slug_state ? (
              <Row term={t("ops.detail.field.slugState")}>
                {label(t, SLUG_STATE_KEYS, detail.slug_state.state)}
              </Row>
            ) : null}
            <Row term={t("ops.detail.field.template")}>{label(t, TEMPLATE_KEYS, w.template)}</Row>
            <Row term={t("ops.detail.field.locales")}>
              {w.locales.map((l) => label(t, LOCALE_KEYS, l)).join(", ")}
            </Row>
            <Row term={t("ops.detail.field.defaultLocale")}>
              {label(t, LOCALE_KEYS, w.default_locale)}
            </Row>
            <Row term={t("ops.detail.field.date")}>
              {formatDay(w.starts_on, none)}
              {w.ends_on && w.ends_on !== w.starts_on ? ` až ${formatDay(w.ends_on, none)}` : ""}
            </Row>
            <Row term={t("ops.detail.field.timezone")}>{w.timezone}</Row>
            <Row term={t("ops.detail.field.created")}>{formatMoment(w.created_at, none)}</Row>
            <Row term={t("ops.detail.field.published")}>{formatMoment(w.published_at, none)}</Row>
            <Row term={t("ops.detail.field.version")}>
              {w.published_version_no === null ? none : `#${w.published_version_no}`}
            </Row>
            <Row term={t("ops.detail.field.activity")}>
              {formatMoment(w.last_activity_at, none)}
            </Row>
            {detail.order ? (
              <>
                <Row term={t("ops.detail.field.plan")}>{detail.order.plan_code}</Row>
                <Row term={t("ops.detail.field.service")}>
                  {formatDay(detail.order.service_ends_at, none)}
                </Row>
              </>
            ) : null}
            <Row term={t("ops.detail.field.healthPurge")}>{formatDay(w.health_purge_at, none)}</Row>
            <Row term={t("ops.detail.field.guestPurge")}>{formatDay(w.guest_purge_at, none)}</Row>
            {w.purge_at ? (
              <Row term={t("ops.detail.field.purge")}>{formatMoment(w.purge_at, none)}</Row>
            ) : null}
            <Row term={t("ops.detail.field.guests")}>{detail.counts.guests}</Row>
            <Row term={t("ops.detail.field.households")}>{detail.counts.households}</Row>
            <Row term={t("ops.detail.field.responses")}>{detail.counts.responses}</Row>
          </dl>
          <p className="mt-4">
            {siteUrl ? (
              <a
                href={siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-pine inline-flex min-h-[2.75rem] items-center underline underline-offset-4"
              >
                {t("ops.detail.site.open")}
              </a>
            ) : (
              t("ops.detail.site.none")
            )}
          </p>
          {w.has_preview ? (
            <p className="text-muted mt-2 max-w-prose">{t("ops.detail.site.preview")}</p>
          ) : null}
        </section>

        <section aria-labelledby="d-admins">
          <SectionTitle id="d-admins">{t("ops.detail.admins.title")}</SectionTitle>
          <TableRegion label={t("ops.detail.admins.caption")}>
            <table className={tableClass}>
              <caption className="sr-only">{t("ops.detail.admins.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>
                    {t("ops.detail.col.email")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.detail.col.added")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.detail.col.lastLogin")}
                  </th>
                  <th scope="col" className={thClass}>
                    {t("ops.detail.col.state")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.admins.map((admin) => (
                  <tr key={admin.id}>
                    <th scope="row" className={`${tdClass} font-normal break-all`}>
                      {admin.email}
                    </th>
                    <td className={tdClass}>{formatDay(admin.added_at, none)}</td>
                    <td className={tdClass}>{formatMoment(admin.last_login_at, none)}</td>
                    <td className={tdClass}>
                      {admin.removed_at
                        ? t("ops.detail.admin.removed")
                        : t("ops.detail.admin.active")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        </section>

        <section aria-labelledby="d-history">
          <SectionTitle id="d-history">{t("ops.detail.history.title")}</SectionTitle>
          {detail.history.length === 0 ? (
            <p>{t("ops.detail.history.none")}</p>
          ) : (
            <TableRegion label={t("ops.detail.history.caption")}>
              <table className={tableClass}>
                <caption className="sr-only">{t("ops.detail.history.caption")}</caption>
                <thead>
                  <tr>
                    <th scope="col" className={thClass}>
                      {t("ops.detail.col.when")}
                    </th>
                    <th scope="col" className={thClass}>
                      {t("ops.detail.col.from")}
                    </th>
                    <th scope="col" className={thClass}>
                      {t("ops.detail.col.to")}
                    </th>
                    <th scope="col" className={thClass}>
                      {t("ops.detail.col.by")}
                    </th>
                    <th scope="col" className={thClass}>
                      {t("ops.detail.col.reason")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.history.map((row, index) => (
                    <tr key={`${row.created_at}-${index}`}>
                      <th scope="row" className={`${tdClass} font-normal`}>
                        {formatMoment(row.created_at, none)}
                      </th>
                      <td className={tdClass}>
                        {row.from_status ? label(t, STATUS_KEYS, row.from_status) : "–"}
                      </td>
                      <td className={tdClass}>{label(t, STATUS_KEYS, row.to_status)}</td>
                      <td className={tdClass}>{label(t, ACTOR_KEYS, row.actor_type)}</td>
                      <td className={tdClass}>{row.reason ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
          )}
        </section>

        <section aria-labelledby="d-notes">
          <SectionTitle id="d-notes">{t("ops.detail.notes.title")}</SectionTitle>
          {detail.notes.length === 0 ? (
            <p>{t("ops.detail.notes.none")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {detail.notes.map((note) => (
                <li key={note.id} className="border-hairline bg-warm rounded-2xl border p-4">
                  <p className="whitespace-pre-wrap">{note.body}</p>
                  <p className="text-muted mt-2 text-sm">
                    {t("ops.detail.notes.meta", {
                      email: note.operator_email,
                      when: formatMoment(note.created_at, none),
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="d-actions">
          <SectionTitle id="d-actions">{t("ops.detail.actions.title")}</SectionTitle>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card as="section" aria-labelledby="a-status">
              <h3 id="a-status" className="mb-3 text-xl font-medium">
                {t("ops.action.status.title")}
              </h3>
              {statusOptions.length > 0 ? (
                <StatusForm
                  weddingId={w.id}
                  errors={errors}
                  options={statusOptions}
                  labels={{
                    status: t("ops.action.status.label"),
                    ...reason,
                    submit: t("ops.action.status.submit"),
                  }}
                />
              ) : (
                <p>{t("ops.detail.actions.statusNone")}</p>
              )}
              {!can(session.role, "set_status") ? (
                <p className="text-muted mt-3 text-sm">{t("ops.action.status.supportHint")}</p>
              ) : null}
            </Card>

            <Card as="section" aria-labelledby="a-link">
              <h3 id="a-link" className="mb-3 text-xl font-medium">
                {t("ops.action.link.title")}
              </h3>
              {activeAdmins.length > 0 && !deleted && status !== "blocked" ? (
                <LoginLinkForm
                  weddingId={w.id}
                  errors={errors}
                  admins={activeAdmins.map((a) => ({ value: a.id, label: a.email }))}
                  labels={{
                    admin: t("ops.action.link.label"),
                    hint: t("ops.action.link.hint"),
                    submit: t("ops.action.link.submit"),
                  }}
                />
              ) : (
                <p>{t("ops.action.link.none")}</p>
              )}
            </Card>

            <Card as="section" aria-labelledby="a-note">
              <h3 id="a-note" className="mb-3 text-xl font-medium">
                {t("ops.action.note.title")}
              </h3>
              <NoteForm
                weddingId={w.id}
                errors={errors}
                labels={{
                  note: t("ops.action.note.label"),
                  hint: t("ops.action.note.hint"),
                  submit: t("ops.action.note.submit"),
                }}
              />
            </Card>

            {can(session.role, "change_slug") && !deleted ? (
              <Card as="section" aria-labelledby="a-slug">
                <h3 id="a-slug" className="mb-3 text-xl font-medium">
                  {t("ops.action.slug.title")}
                </h3>
                <SlugForm
                  weddingId={w.id}
                  errors={errors}
                  labels={{
                    slug: t("ops.action.slug.label"),
                    slugHint: t("ops.action.slug.hint"),
                    ...reason,
                    submit: t("ops.action.slug.submit"),
                  }}
                />
              </Card>
            ) : null}

            {can(session.role, "extend_retention") && !deleted ? (
              <Card as="section" aria-labelledby="a-extend">
                <h3 id="a-extend" className="mb-3 text-xl font-medium">
                  {t("ops.action.extend.title")}
                </h3>
                <ExtendForm
                  weddingId={w.id}
                  errors={errors}
                  kinds={[
                    { value: "service", label: t("ops.action.extend.kind.service") },
                    { value: "health", label: t("ops.action.extend.kind.health") },
                    { value: "guests", label: t("ops.action.extend.kind.guests") },
                  ]}
                  labels={{
                    kind: t("ops.action.extend.kind"),
                    until: t("ops.action.extend.until"),
                    untilHint: t("ops.action.extend.until.hint"),
                    ...reason,
                    submit: t("ops.action.extend.submit"),
                  }}
                />
              </Card>
            ) : null}

            {can(session.role, "restore") && restorable ? (
              <Card as="section" aria-labelledby="a-restore">
                <h3 id="a-restore" className="mb-3 text-xl font-medium">
                  {t("ops.action.restore.title")}
                </h3>
                <p className="mb-3">
                  {t("ops.action.restore.intro", { date: formatDay(w.purge_at, none) })}
                </p>
                <RestoreForm
                  weddingId={w.id}
                  errors={errors}
                  labels={{
                    ...reason,
                    submit: t("ops.action.restore.submit"),
                  }}
                />
              </Card>
            ) : null}
          </div>
          {!can(session.role, "change_slug") ? (
            <p className="text-muted mt-4 max-w-prose">{t("ops.detail.actions.ownerOnly")}</p>
          ) : null}
        </section>

        {can(session.role, "guest_data") ? (
          <section aria-labelledby="d-guests">
            <SectionTitle id="d-guests">{t("ops.action.guests.title")}</SectionTitle>
            <p className="mb-2 max-w-prose">{t("ops.action.guests.intro")}</p>
            <p className="mb-4 font-medium">
              {detail.guest_access
                ? t("ops.action.guests.consent.active", {
                    until: formatMoment(detail.guest_access.expires_at, none),
                  })
                : t("ops.action.guests.consent.none")}
            </p>
            <GuestDataForm
              weddingId={w.id}
              errors={errors}
              labels={{
                reason: t("ops.action.guests.reason"),
                reasonHint: t("ops.action.reason.hint"),
                submit: t("ops.action.guests.submit"),
                denied: t("ops.guests.denied"),
                empty: t("ops.guests.empty"),
                caption: t("ops.guests.caption"),
                household: t("ops.guests.col.household"),
                name: t("ops.guests.col.name"),
                kind: t("ops.guests.col.kind"),
                diet: t("ops.guests.col.diet"),
                allergies: t("ops.guests.col.allergies"),
                adult: t("ops.guests.kind.adult"),
                child: t("ops.guests.kind.child", { age: "{age}" }),
                childNoAge: t("ops.guests.kind.childNoAge"),
                plusOne: t("ops.guests.kind.plusOne"),
              }}
            />
          </section>
        ) : null}
      </div>
    </OpsShell>
  );
}
