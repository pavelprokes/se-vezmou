"use client";

import { CircleAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { intlLocale, type Locale } from "@/i18n/config";
import { typo } from "@/i18n/typo";
import { missingLocales, pick, type I18nText } from "@/site/i18n-text";
import { templates } from "@/site/themes/palettes";
import type { Issue, WizardDraft } from "@/wizard/draft";
import { toPublicContent } from "@/wizard/content";
import { useT, type WizardKey } from "../i18n";

function formatDay(value: string, locale: Locale): string {
  if (value === "") return "";
  const date = new Date(`${value}T12:00:00Z`);
  return typo(
    new Intl.DateTimeFormat(intlLocale[locale], { dateStyle: "long", timeZone: "UTC" }).format(
      date,
    ),
    locale,
  );
}

/** Texty, které chybí v některém jazyce webu (jen upozornění, web se zveřejnit dá). */
export function translationGaps(draft: WizardDraft): string[] {
  if (draft.locales.length < 2) return [];
  const gaps: string[] = [];
  const check = (key: string, text: I18nText | undefined) => {
    const filled = draft.locales.some((locale) => (text?.[locale] ?? "").trim() !== "");
    if (filled && missingLocales(text, draft.locales).length > 0) gaps.push(key);
  };
  check("dressCode", draft.dressCode);
  check("transport", draft.transport);
  check("ceremony", draft.ceremony.directions);
  check("reception", draft.reception.directions);
  draft.lodging.forEach((item) => check("lodging", item.description));
  draft.extraEvents.forEach((event) => check("extra", event.title));
  return [...new Set(gaps)];
}

function Row({
  label,
  value,
  step,
  onGoTo,
}: {
  label: string;
  value: string;
  step: number;
  onGoTo: (step: number) => void;
}) {
  const t = useT();
  return (
    <div className="border-hairline flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1 basis-60">
        <dt className="text-muted text-sm">{label}</dt>
        <dd className="text-ink font-medium break-words">{value}</dd>
      </div>
      <Button
        variant="text"
        aria-label={t("wizard.review.editLabel", { section: label })}
        onClick={() => onGoTo(step)}
      >
        {t("wizard.review.edit")}
      </Button>
    </div>
  );
}

/** Krok 8: kontrola. Souhrn zadaného, chyby k opravě a upozornění na chybějící překlady. */
export function StepReview({
  draft,
  issues,
  domain,
  onGoTo,
}: {
  draft: WizardDraft;
  issues: Issue[];
  domain: string;
  onGoTo: (step: number, field?: string) => void;
}) {
  const t = useT();
  const locale = t.locale;
  const none = t("wizard.review.none");
  const content = (() => {
    try {
      return toPublicContent(draft, { placeholders: true });
    } catch {
      return null;
    }
  })();

  const languages = draft.locales
    .map(
      (l) =>
        t(`wizard.language.${l}`) +
        (l === draft.defaultLocale && draft.locales.length > 1
          ? ` (${t("wizard.review.mainLanguage")})`
          : ""),
    )
    .join(", ");
  const date =
    draft.startsOn === ""
      ? none
      : draft.endsOn !== "" && draft.endsOn > draft.startsOn
        ? `${formatDay(draft.startsOn, locale)} – ${formatDay(draft.endsOn, locale)}`
        : formatDay(draft.startsOn, locale);
  const template = templates[draft.template];
  const palette = template.palettes.find((p) => p.key === draft.palette);
  const events =
    content && content.events.length > 0
      ? content.events
          .map((event) => {
            const time = new Intl.DateTimeFormat(intlLocale[locale], {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: content.timezone,
            }).format(new Date(event.startsAt));
            return `${time} ${pick(event.title, locale, draft.defaultLocale)}`;
          })
          .join("; ")
      : t("wizard.review.skipped");
  const venues =
    content && content.venues.length > 0
      ? content.venues.map((venue) => pick(venue.name, locale, draft.defaultLocale)).join("; ")
      : t("wizard.review.skipped");
  const info = [
    draft.dressCode[draft.defaultLocale]?.trim() ? t("wizard.review.info.dressCode") : null,
    draft.lodging.some((l) => l.name.trim()) ? t("wizard.review.info.lodging") : null,
    (draft.transport[draft.defaultLocale] ?? "").trim() ? t("wizard.review.info.transport") : null,
    draft.contacts.some((c) => c.name.trim()) ? t("wizard.review.info.contacts") : null,
  ].filter(Boolean);
  const rsvp = [
    draft.rsvp.deadline !== ""
      ? t("wizard.review.rsvp.deadline", { date: formatDay(draft.rsvp.deadline, locale) })
      : t("wizard.review.rsvp.noDeadline"),
    draft.rsvp.plusOne ? t("wizard.review.rsvp.plusOne") : null,
    draft.rsvp.children ? t("wizard.review.rsvp.children") : null,
    draft.rsvp.diet ? t("wizard.review.rsvp.diet") : null,
    draft.rsvp.emailConfirmation ? t("wizard.review.rsvp.email") : null,
  ].filter(Boolean);
  const gaps = translationGaps(draft);

  return (
    <div className="flex flex-col gap-6">
      {issues.length > 0 ? (
        <section
          aria-labelledby="wz-review-issues"
          className="border-cinnamon-deep rounded-2xl border-2 p-4"
          data-testid="review-issues"
        >
          <h3
            id="wz-review-issues"
            className="text-cinnamon-deep flex items-center gap-2 text-lg font-medium"
          >
            <Icon icon={CircleAlert} size={22} />
            {t("wizard.review.issues.title", { count: issues.length })}
          </h3>
          <ul className="mt-2 flex flex-col">
            {issues.map((issue) => (
              <li
                key={`${issue.field}-${issue.code}`}
                className="flex flex-wrap items-center gap-x-3"
              >
                <span className="flex-1 basis-56">
                  {t(`wizard.issue.${issue.code}` as WizardKey)}
                </span>
                <Button variant="text" onClick={() => onGoTo(issue.step, issue.field)}>
                  {t("wizard.review.issues.fix", { step: issue.step })}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="bg-linen rounded-button px-3 py-2 font-medium" data-testid="review-ok">
          {t("wizard.review.ok")}
        </p>
      )}

      {gaps.length > 0 ? (
        <section aria-labelledby="wz-review-gaps" className="bg-linen rounded-2xl p-4">
          <h3 id="wz-review-gaps" className="flex items-center gap-2 text-lg font-medium">
            <Icon icon={TriangleAlert} size={22} />
            {t("wizard.review.gaps.title")}
          </h3>
          <p className="mt-2 text-sm">
            {t("wizard.review.gaps.body", {
              parts: gaps.map((gap) => t(`wizard.review.gaps.${gap}` as WizardKey)).join(", "),
            })}
          </p>
        </section>
      ) : null}

      <dl className="bg-warm border-hairline rounded-2xl border px-4">
        <Row
          label={t("wizard.review.names")}
          value={`${draft.partnerA || none} ${t("wizard.review.and")} ${draft.partnerB || none}`.replace(
            /\s+/g,
            " ",
          )}
          step={1}
          onGoTo={onGoTo}
        />
        <Row label={t("wizard.review.languages")} value={languages} step={1} onGoTo={onGoTo} />
        <Row label={t("wizard.review.date")} value={date} step={2} onGoTo={onGoTo} />
        <Row
          label={t("wizard.review.address")}
          value={draft.slug ? `${draft.slug}.${domain}` : none}
          step={2}
          onGoTo={onGoTo}
        />
        <Row
          label={t("wizard.review.template")}
          value={`${pick(template.name, locale)}, ${palette ? pick(palette.name, locale) : none}`}
          step={3}
          onGoTo={onGoTo}
        />
        <Row label={t("wizard.review.program")} value={events} step={4} onGoTo={onGoTo} />
        <Row label={t("wizard.review.venues")} value={venues} step={4} onGoTo={onGoTo} />
        <Row
          label={t("wizard.review.info")}
          value={info.length > 0 ? info.join(", ") : t("wizard.review.skipped")}
          step={5}
          onGoTo={onGoTo}
        />
        <Row label={t("wizard.review.rsvp")} value={rsvp.join("; ")} step={6} onGoTo={onGoTo} />
        <Row
          label={t("wizard.review.access")}
          value={draft.guestPin.enabled ? t("wizard.review.pinOn") : t("wizard.review.pinOff")}
          step={7}
          onGoTo={onGoTo}
        />
      </dl>
    </div>
  );
}
