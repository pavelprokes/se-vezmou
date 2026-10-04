import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { WaitlistFormClient } from "./waitlist-form-client";

/** Čekací listina: server přeloží všechny texty, klientský formulář je jen zobrazí. */
export async function WaitlistForm({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  return (
    <section
      id="waitlist"
      aria-labelledby="waitlist-title"
      className="border-hairline rounded-2xl border bg-white p-6 md:p-8"
    >
      <h3 id="waitlist-title" className="font-display text-2xl font-medium">
        {t("landing.waitlist.title")}
      </h3>
      <p className="text-muted mt-2">{t("landing.waitlist.lead")}</p>
      <WaitlistFormClient
        locale={locale}
        labels={{
          email: t("landing.waitlist.email"),
          consent: t("landing.waitlist.consent"),
          submit: t("landing.waitlist.submit"),
          pending: t("landing.waitlist.pending"),
          success: t("landing.waitlist.success"),
          honeypot: t("landing.waitlist.honeypot"),
          errors: {
            emailRequired: t("landing.waitlist.error.email.required"),
            emailInvalid: t("landing.waitlist.error.email.invalid"),
            consentRequired: t("landing.waitlist.error.consent.required"),
            rateLimited: t("landing.waitlist.error.rateLimited"),
            check: t("landing.waitlist.error.check"),
            bot: t("landing.waitlist.error.bot"),
            generic: t("landing.waitlist.error.generic"),
          },
        }}
      />
    </section>
  );
}
