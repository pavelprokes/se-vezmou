import { buttonVariants } from "@/components/ui/button";
import { pricing } from "@/config/pricing";
import type { Locale } from "@/i18n/config";
import { createTranslator, formatCurrency } from "@/i18n/translator";
import { appUrl } from "@/lib/site";
import { buildWizardUrl } from "@/lib/wizard-link";
import { cn } from "@/lib/utils";
import { Section, SectionHeading } from "./section";

/** Cena: dvě karty, obě 0 Kč po dobu zaváděcího provozu. Hodnoty jsou v `config/pricing.ts`. */
export function PricingSection({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const conditions = pricing.conditionsPlaceholder;

  const cards = {
    concept: {
      label: t("landing.pricing.concept.label"),
      items: [
        t("landing.pricing.concept.item1"),
        t("landing.pricing.concept.item2"),
        t("landing.pricing.concept.item3"),
      ],
    },
    published: {
      label: t("landing.pricing.published.label"),
      items: [
        t("landing.pricing.published.item1"),
        t("landing.pricing.published.item2"),
        t("landing.pricing.published.item3"),
        t("landing.pricing.published.item4", { conditions }),
      ],
    },
  } as const;

  return (
    <Section id="pricing" headingId="pricing-title">
      <SectionHeading
        id="pricing-title"
        title={t.rich("landing.pricing.title", {
          b: (children) => <span className="heading-accent">{children}</span>,
        })}
        lead={t("landing.pricing.lead")}
      />
      <ul className="mt-10 grid max-w-3xl gap-5 md:grid-cols-2">
        {pricing.plans.map((plan) => {
          const card = cards[plan.id];
          return (
            <li
              key={plan.id}
              className={cn(
                "flex flex-col rounded-2xl bg-white p-6",
                plan.highlighted ? "border-cinnamon-deep border-2" : "border-hairline border",
              )}
            >
              <h3 className="text-cinnamon-deep font-sans text-xs font-bold tracking-widest uppercase">
                {card.label}
              </h3>
              <p className="mt-3 font-sans text-5xl font-bold tracking-tight">
                <span className="sr-only">{t("landing.pricing.priceLabel")}: </span>
                {formatCurrency(plan.price, locale, pricing.currency)}
              </p>
              <ul className="text-muted mt-5 flex flex-1 list-disc flex-col gap-2 pl-5 text-sm">
                {card.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {plan.highlighted ? (
                <a
                  href={buildWizardUrl({ appUrl, locale })}
                  className={buttonVariants({ fullWidth: true, className: "mt-6" })}
                >
                  {t("landing.pricing.published.cta")}
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
