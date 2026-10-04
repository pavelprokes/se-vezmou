import { buttonVariants } from "@/components/ui/button";
import { pricing } from "@/config/pricing";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { formatCurrency } from "@/i18n/translator";
import { appUrl } from "@/lib/site";
import { buildWizardUrl } from "@/lib/wizard-link";
import { Section, SectionHeading } from "./section";

const ITEMS = [1, 2, 3, 4, 5, 6] as const;

/** Cena: nadpis a pod ním mezi linkami cena s výzvou a výčet toho, co člověk dostane (`config/pricing.ts`). */
export async function PricingSection({ locale, number }: { locale: Locale; number?: number }) {
  const t = await getTranslator(locale, ["landing"]);
  const [plan] = pricing.plans;

  return (
    <Section id="pricing" headingId="pricing-title">
      <SectionHeading
        id="pricing-title"
        number={number}
        title={t.rich("landing.pricing.title", {
          b: (children) => <span className="heading-accent">{children}</span>,
        })}
        lead={t("landing.pricing.lead")}
      />
      <ul className="mt-12">
        <li className="border-ink grid gap-8 border-y-2 py-8 md:grid-cols-[auto_1fr] md:gap-16">
          <div className="flex flex-col items-start gap-6">
            <p className="font-display text-7xl leading-none font-normal tracking-tight">
              <span className="sr-only">{t("landing.pricing.priceLabel")}: </span>
              {formatCurrency(plan.price, locale, pricing.currency)}
            </p>
            <a href={buildWizardUrl({ appUrl, locale })} className={buttonVariants()}>
              {t("landing.pricing.cta")}
            </a>
          </div>
          <ul className="text-muted grid list-disc gap-x-10 gap-y-2 pl-5 text-lg sm:grid-cols-2">
            {ITEMS.map((n) => (
              <li key={n}>{t(`landing.pricing.item${n}`)}</li>
            ))}
          </ul>
        </li>
      </ul>
    </Section>
  );
}
