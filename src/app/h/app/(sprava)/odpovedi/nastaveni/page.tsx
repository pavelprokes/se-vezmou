import type { Metadata } from "next";
import { ADMIN_PATHS } from "@/admin/paths";
import { loadRsvpSettings } from "@/admin/guests/server";
import { BUILTIN_QUESTIONS, type BuiltinQuestion } from "@/admin/guests/types";
import { getUiLocale } from "@/auth/request";
import { requireSession } from "@/auth/session";
import { AdminFrame } from "@/components/admin/frame";
import { RsvpSettings, type SettingsInitial } from "@/components/admin/guests/rsvp-settings";
import { AdminI18nProvider } from "@/components/admin/i18n";
import { pickAdminMessages } from "@/components/admin/messages";
import { getTranslator } from "@/i18n/load";
import { i18nTextSchema, pick } from "@/site/i18n-text";
import { saveSettingsAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["admin.guests"]))("admin.guests.rsvp.title"),
  };
}

function optionsOf(
  raw: unknown[] | null,
): { value: string; label: ReturnType<typeof i18nTextSchema.parse> | null }[] {
  const options: { value: string; label: ReturnType<typeof i18nTextSchema.parse> | null }[] = [];
  for (const item of raw ?? []) {
    if (typeof item !== "object" || item === null) continue;
    const { value, label } = item as { value?: unknown; label?: unknown };
    const parsed = i18nTextSchema.safeParse(label);
    if (typeof value === "string" && parsed.success) options.push({ value, label: parsed.data });
  }
  return options;
}

/** Nastavení RSVP (FR-RSVP-4, FR-RSVP-5): otevření a uzavření, otázky, host mimo seznam. */
export default async function RsvpSettingsPage() {
  const session = await requireSession();
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["admin.guests"]);
  const view = await loadRsvpSettings(session);

  const flags: Partial<Record<BuiltinQuestion, boolean>> = {};
  for (const key of BUILTIN_QUESTIONS) {
    flags[key] = view.settings.enabled_questions[key] === true;
  }
  const initial: SettingsInitial = {
    opensAt: view.settings.opens_at,
    closesAt: view.settings.closes_at,
    allowUnlisted: view.settings.allow_unlisted,
    emailConfirmation: view.settings.email_confirmation,
    enabledQuestions: flags,
    questions: view.questions.map((question) => ({
      id: question.id,
      key: question.key,
      type: question.type,
      label: question.label,
      options: optionsOf(question.options),
      required: question.required,
      eventId: question.event_id,
      enabled: question.enabled,
    })),
  };

  return (
    <AdminI18nProvider locale={locale} messages={await pickAdminMessages(locale)}>
      <AdminFrame
        locale={locale}
        path={ADMIN_PATHS.rsvpSettings}
        active="responses"
        title={t("admin.guests.rsvp.title")}
        intro={t("admin.guests.rsvp.intro")}
        help="rsvp"
      >
        <RsvpSettings
          initial={initial}
          timeZone={view.timezone}
          locales={view.locales}
          events={view.events.map((event) => ({
            id: event.id,
            title: pick(event.title, locale, view.default_locale) || "?",
          }))}
          save={saveSettingsAction}
        />
      </AdminFrame>
    </AdminI18nProvider>
  );
}
