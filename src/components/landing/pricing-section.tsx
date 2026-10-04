import { buttonVariants } from "@/components/ui/button";
import { pricing } from "@/config/pricing";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { formatCurrency } from "@/i18n/translator";
import { appUrl } from "@/lib/site";
import { buildWizardUrl } from "@/lib/wizard-link";
import { Section, SectionHeading } from "./section";

const ITEMS = [1, 2, 3, 4, 5, 6] as const;

/** Cena: jedna karta s cenou a výčtem toho, co člověk dostane. Hodnota je v `config/pricing.ts`. */
export async function PricingSection({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["landing"]);
  const [plan] = pricing.plans;

  return (
    <Section id="pricing" headingId="pricing-title">
      <SectionHeading
        id="pricing-title"
        title={t.rich("landing.pricing.title", {
          b: (children) => <span className="heading-accent">{children}</span>,
        })}
        lead={t("landing.pricing.lead")}
      />
      <ul className="mt-10 max-w-3xl">
        <li className="border-cinnamon-deep grid gap-6 rounded-2xl border-2 bg-white p-6 md:grid-cols-[auto_1fr] md:gap-10 md:p-8">
          <div className="flex flex-col justify-between gap-6">
            <p className="font-sans text-5xl font-bold tracking-tight">
              <span className="sr-only">{t("landing.pricing.priceLabel")}: </span>
              {formatCurrency(plan.price, locale, pricing.currency)}
            </p>
            <a
              href={buildWizardUrl({ appUrl, locale })}
              className={buttonVariants({ fullWidth: true })}
            >
              {t("landing.pricing.cta")}
            </a>
          </div>
          <ul className="text-muted flex list-disc flex-col gap-2 pl-5">
            {ITEMS.map((n) => (
              <li key={n}>{t(`landing.pricing.item${n}`)}</li>
            ))}
          </ul>
        </li>
      </ul>
    </Section>
  );
}
