import type { Locale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";
import { WaitlistFormClient } from "./waitlist-form-client";

/** Čekací listina: server přeloží všechny texty, klientský formulář je jen zobrazí. */
export function WaitlistForm({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <section
      id="waitlist"
      aria-labelledby="waitlist-title"
      className="border-hairline mt-12 max-w-2xl rounded-2xl border bg-white p-6 md:p-8"
    >
      <h3 id="waitlist-title" className="font-sans text-xl font-bold">
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
            generic: t("landing.waitlist.error.generic"),
          },
        }}
      />
    </section>
  );
}
