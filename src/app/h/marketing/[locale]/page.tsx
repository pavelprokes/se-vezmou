import type { Metadata } from "next";
import { CtaSection } from "@/components/landing/cta-section";
import { FaqSection } from "@/components/landing/faq-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { Hero } from "@/components/landing/hero";
import { IntroSection } from "@/components/landing/intro-section";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { PricingSection } from "@/components/landing/pricing-section";
import { ProblemSection } from "@/components/landing/problem-section";
import { ReferencesSection } from "@/components/landing/references-section";
import { StepsSection } from "@/components/landing/steps-section";
import { HomeStructuredData } from "@/components/landing/structured-data";
import { TemplatesSection } from "@/components/landing/templates-section";
import { TrustSection } from "@/components/landing/trust-section";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";
import { siteUrl } from "@/lib/site";
import { pageMetadata } from "@/seo/page-metadata";

export async function generateMetadata({
  params,
}: PageProps<"/h/marketing/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return pageMetadata({
    route: "home",
    locale,
    siteUrl,
    title: t("marketing.home.metaTitle"),
    description: t("marketing.home.metaDescription"),
    siteName: t("common.brand"),
    imageAlt: t("marketing.home.ogAlt"),
  });
}

/**
 * Úvodní stránka (FR-LP-1 až FR-LP-6): dvanáct sekcí v pevném pořadí, celá vykreslená na serveru.
 * Pořadí: hero, co je služba, problém a řešení, jak se web sestavuje, šablony, co web umí,
 * soukromí a přístupnost, cena, reference (s čekací listinou), FAQ, závěrečná výzva, patička.
 */
export default async function MarketingHome({ params }: PageProps<"/h/marketing/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;

  return (
    <>
      <HomeStructuredData locale={locale} />
      <LandingHeader locale={locale} route="home" />
      <main id="obsah" tabIndex={-1}>
        <Hero locale={locale} />
        <IntroSection locale={locale} />
        <ProblemSection locale={locale} />
        <StepsSection locale={locale} />
        <TemplatesSection locale={locale} />
        <FeaturesSection locale={locale} />
        <TrustSection locale={locale} />
        <PricingSection locale={locale} />
        <ReferencesSection locale={locale} />
        <FaqSection locale={locale} />
        <CtaSection locale={locale} />
      </main>
      <LandingFooter locale={locale} route="home" />
    </>
  );
}
