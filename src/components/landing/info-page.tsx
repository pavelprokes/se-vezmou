import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import type { MessageKey } from "@/i18n/messages";
import { localizedPath, type RouteName } from "@/i18n/pathnames";
import { getTranslator } from "@/i18n/load";
import { siteUrl } from "@/lib/site";
import { pageMetadata } from "@/seo/page-metadata";
import { CtaSection } from "./cta-section";
import { FaqSection } from "./faq-section";
import { LandingFooter } from "./landing-footer";
import { LandingHeader } from "./landing-header";
import { PricingSection } from "./pricing-section";
import { Section, itemTitleClass, sectionTitleClass } from "./section";
import { SubpageStructuredData } from "./structured-data";
import { TemplatesSection } from "./templates-section";

/**
 * Indexovatelné podstránky úvodního webu (cena, šablony, dvojjazyčný web). Skládají se z hotových
 * sekcí úvodní stránky, takže texty a ceny mají jediný zdroj. Každý jazyk má vlastní složku
 * (`cenik`, `pricing`, ...) a stránka ověří, že složka patří jazyku z adresy (jinak 404).
 */
export type InfoRoute = Extract<RouteName, "pricing" | "templates" | "bilingual">;

const KEYS = {
  pricing: {
    title: "marketing.pricing.metaTitle",
    description: "marketing.pricing.metaDescription",
    breadcrumb: "marketing.pricing.breadcrumb",
    h1: "marketing.pricing.h1",
    lead: "marketing.pricing.lead",
  },
  templates: {
    title: "marketing.templates.metaTitle",
    description: "marketing.templates.metaDescription",
    breadcrumb: "marketing.templates.breadcrumb",
    h1: "marketing.templates.h1",
    lead: "marketing.templates.lead",
  },
  bilingual: {
    title: "marketing.bilingual.metaTitle",
    description: "marketing.bilingual.metaDescription",
    breadcrumb: "marketing.bilingual.breadcrumb",
    h1: "marketing.bilingual.h1",
    lead: "marketing.bilingual.lead",
  },
} as const satisfies Record<InfoRoute, Record<string, MessageKey>>;

/** Jazyk z adresy, pokud je složka `segment` jeho přeloženou cestou k `route`; jinak `null`. */
function infoLocale(route: InfoRoute, segment: string, localeParam: string): Locale | null {
  if (!isLocale(localeParam)) return null;
  return localizedPath(route, localeParam).split("/").pop() === segment ? localeParam : null;
}

export async function infoMetadata(
  route: InfoRoute,
  segment: string,
  localeParam: string,
): Promise<Metadata> {
  const locale = infoLocale(route, segment, localeParam);
  if (!locale) return {};
  const t = await getTranslator(locale, ["common", "marketing"]);
  return pageMetadata({
    route,
    locale,
    siteUrl,
    title: t(KEYS[route].title),
    description: t(KEYS[route].description),
    siteName: t("common.brand"),
    imageAlt: t("marketing.home.ogAlt"),
  });
}

async function BilingualPoints({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["marketing"]);
  const points = [
    {
      title: t("marketing.bilingual.points.1.title"),
      text: t("marketing.bilingual.points.1.text"),
    },
    {
      title: t("marketing.bilingual.points.2.title"),
      text: t("marketing.bilingual.points.2.text"),
    },
    {
      title: t("marketing.bilingual.points.3.title"),
      text: t("marketing.bilingual.points.3.text"),
    },
  ];
  return (
    <Section headingId="bilingual-points-title" tone="warm">
      <h2 id="bilingual-points-title" className={sectionTitleClass}>
        {t("marketing.bilingual.points.title")}
      </h2>
      <ul className="mt-12 grid gap-10 md:grid-cols-3">
        {points.map((point) => (
          <li key={point.title} className="border-ink border-t-2 pt-5">
            <h3 className={itemTitleClass}>{point.title}</h3>
            <p className="text-muted mt-3 text-lg">{point.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export async function InfoPage({
  route,
  segment,
  localeParam,
}: {
  route: InfoRoute;
  segment: string;
  localeParam: string;
}) {
  const locale = infoLocale(route, segment, localeParam);
  if (!locale) notFound();
  const t = await getTranslator(locale, ["common", "marketing"]);
  const keys = KEYS[route];
  const crumbs = [
    {
      name: t("marketing.home.breadcrumb"),
      url: new URL(localizedPath("home", locale), siteUrl).toString(),
    },
    { name: t(keys.breadcrumb), url: new URL(localizedPath(route, locale), siteUrl).toString() },
  ];

  return (
    <>
      <SubpageStructuredData locale={locale} crumbs={crumbs} />
      <LandingHeader locale={locale} route={route} />
      <main id="obsah" tabIndex={-1}>
        <Section headingId="page-title">
          <h1
            id="page-title"
            className="font-display text-5xl leading-[1.02] font-normal tracking-tight text-balance md:text-6xl lg:text-7xl"
          >
            {t(keys.h1)}
          </h1>
          <p className="text-muted mt-5 max-w-2xl text-lg text-pretty md:text-xl">{t(keys.lead)}</p>
        </Section>
        {route === "pricing" ? (
          <>
            <PricingSection locale={locale} />
            <FaqSection locale={locale} />
          </>
        ) : null}
        {route === "templates" ? <TemplatesSection locale={locale} /> : null}
        {route === "bilingual" ? (
          <>
            <BilingualPoints locale={locale} />
            <FaqSection locale={locale} />
          </>
        ) : null}
        <CtaSection locale={locale} />
      </main>
      <LandingFooter locale={locale} route={route} />
    </>
  );
}
