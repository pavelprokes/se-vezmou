import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { htmlLang, isLocale, type Locale } from "@/i18n/config";
import type { MessageKey } from "@/i18n/messages";
import { localizedPath, type RouteName } from "@/i18n/pathnames";
import { getTranslator } from "@/i18n/load";
import { siteUrl } from "@/lib/site";
import { pricing } from "@/config/pricing";
import {
  faqPageLd,
  serviceLd,
  softwareApplicationLd,
  webPageLd,
  type JsonLdNode,
} from "@/seo/json-ld";
import { pageMetadata } from "@/seo/page-metadata";
import { CtaSection } from "./cta-section";
import {
  getBilingualFaqItems,
  getFaqItems,
  getPhotographerFaqItems,
  getRsvpFaqItems,
  getTemplateFaqItems,
} from "./faq";
import { FactsSection } from "./facts-section";
import { FaqSection } from "./faq-section";
import { LandingFooter } from "./landing-footer";
import { LandingHeader } from "./landing-header";
import { PartnerKit } from "./partner-kit";
import { PricingSection } from "./pricing-section";
import { Section, itemTitleClass, sectionTitleClass } from "./section";
import { SubpageStructuredData, getOfferInput } from "./structured-data";
import { TemplatesSection } from "./templates-section";

/**
 * Indexovatelné podstránky úvodního webu (cena, šablony, dvojjazyčný web, pro fotografy). Skládají se z hotových
 * sekcí úvodní stránky, takže texty a ceny mají jediný zdroj. Každý jazyk má vlastní složku
 * (`cenik`, `pricing`, ...) a stránka ověří, že složka patří jazyku z adresy (jinak 404).
 */
export type InfoRoute = Extract<
  RouteName,
  "pricing" | "templates" | "bilingual" | "rsvp" | "photographers"
>;

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
  rsvp: {
    title: "marketing.rsvp.metaTitle",
    description: "marketing.rsvp.metaDescription",
    breadcrumb: "marketing.rsvp.breadcrumb",
    h1: "marketing.rsvp.h1",
    lead: "marketing.rsvp.lead",
  },
  photographers: {
    title: "marketing.photographers.metaTitle",
    description: "marketing.photographers.metaDescription",
    breadcrumb: "marketing.photographers.breadcrumb",
    h1: "marketing.photographers.h1",
    lead: "marketing.photographers.lead",
  },
} as const satisfies Record<InfoRoute, Record<string, MessageKey>>;

/**
 * Datum poslední věcné úpravy podstránek (`YYYY-MM-DD`): viditelné „Aktualizováno“ i `dateModified`.
 * Při změně textu podstránky ho posuňte.
 */
const UPDATED = "2026-10-07";

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

/** Šablony podle typu svatby (`marketing.templates.byStyle.*`). */
async function StyleGuide({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["marketing"]);
  return (
    <Section headingId="styles-title" tone="warm" className="print:hidden">
      <h2 id="styles-title" className={sectionTitleClass}>
        {t("marketing.templates.byStyle.title")}
      </h2>
      <dl className="mt-12 grid gap-x-10 gap-y-8 md:grid-cols-2">
        {([1, 2, 3, 4, 5, 6] as const).map((n) => (
          <div key={n} className="border-ink border-t-2 pt-5">
            <dt className={itemTitleClass}>{t(`marketing.templates.byStyle.${n}.type`)}</dt>
            <dd className="text-muted mt-3 text-lg">
              {t(`marketing.templates.byStyle.${n}.names`)}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/** Tři body s nadpisem (`marketing.<route>.points.*`). */
async function Points({
  locale,
  route,
}: {
  locale: Locale;
  route: "bilingual" | "rsvp" | "photographers";
}) {
  const t = await getTranslator(locale, ["marketing"]);
  const points = ([1, 2, 3] as const).map((n) => ({
    title: t(`marketing.${route}.points.${n}.title`),
    text: t(`marketing.${route}.points.${n}.text`),
  }));
  return (
    <Section headingId={`${route}-points-title`} tone="warm" className="print:hidden">
      <h2 id={`${route}-points-title`} className={sectionTitleClass}>
        {t(`marketing.${route}.points.title`)}
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

async function PartnerKitSection({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["marketing"]);
  const k = "marketing.photographers.kit" as const;
  return (
    <Section headingId="partner-kit-title" className="print:p-0">
      <h2 id="partner-kit-title" className={`${sectionTitleClass} print:hidden`}>
        {t(`${k}.title`)}
      </h2>
      <p className="text-muted mt-5 mb-8 max-w-2xl text-lg print:hidden">{t(`${k}.lead`)}</p>
      <PartnerKit
        homeUrl={new URL(localizedPath("home", locale), siteUrl).toString()}
        labels={{
          name: t(`${k}.name`),
          nameHint: t(`${k}.nameHint`),
          link: t(`${k}.link`),
          copy: t(`${k}.copy`),
          copyLabel: t(`${k}.copyLabel`),
          copied: t(`${k}.copied`),
          qr: t(`${k}.qr`),
          print: t(`${k}.print`),
          empty: t(`${k}.empty`),
          leafletTitle: t(`${k}.leafletTitle`),
          leafletLead: t(`${k}.leafletLead`),
          leafletPoints: [
            t(`${k}.leafletPoint1`),
            t(`${k}.leafletPoint2`),
            t(`${k}.leafletPoint3`),
          ],
          leafletScan: t(`${k}.leafletScan`),
          leafletBy: t(`${k}.leafletBy`, { name: "{name}" }),
        }}
      />
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
  const t = await getTranslator(locale, ["common", "landing", "marketing"]);
  const keys = KEYS[route];
  const pageUrl = new URL(localizedPath(route, locale), siteUrl).toString();
  const faq =
    route === "templates"
      ? await getTemplateFaqItems(locale)
      : route === "photographers"
        ? await getPhotographerFaqItems(locale)
        : route === "bilingual"
          ? await getBilingualFaqItems(locale)
          : route === "rsvp"
            ? await getRsvpFaqItems(locale)
            : await getFaqItems(locale);
  const extra: JsonLdNode[] = [
    webPageLd({
      siteUrl,
      url: pageUrl,
      name: t(keys.h1),
      description: t(keys.description),
      locale,
      dateModified: UPDATED,
    }),
    faqPageLd(faq),
  ];
  if (route !== "photographers") {
    const offerInput = await getOfferInput(locale);
    extra.push(softwareApplicationLd(offerInput), serviceLd(offerInput));
  }
  const updated = new Intl.DateTimeFormat(htmlLang[locale], {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(UPDATED));
  const crumbs = [
    {
      name: t("marketing.home.breadcrumb"),
      url: new URL(localizedPath("home", locale), siteUrl).toString(),
    },
    { name: t(keys.breadcrumb), url: pageUrl },
  ];

  return (
    <>
      <SubpageStructuredData locale={locale} crumbs={crumbs} extra={extra} />
      <div className="print:hidden">
        <LandingHeader locale={locale} route={route} />
      </div>
      <main id="obsah" tabIndex={-1}>
        <Section headingId="page-title" className="print:hidden">
          <h1
            id="page-title"
            className="font-display text-5xl leading-[1.02] font-normal tracking-tight text-balance md:text-6xl lg:text-7xl"
          >
            {t(keys.h1)}
          </h1>
          <p id="page-lead" className="text-muted mt-5 max-w-2xl text-lg text-pretty md:text-xl">
            {t(keys.lead)}
          </p>
          <p className="text-muted mt-4 text-sm">
            <time dateTime={UPDATED}>{t("marketing.updated", { date: updated })}</time>
          </p>
        </Section>
        {route === "pricing" ? (
          <>
            <PricingSection locale={locale} />
            <FactsSection locale={locale} />
            <FaqSection locale={locale} items={faq} />
          </>
        ) : null}
        {route === "templates" ? (
          <>
            <TemplatesSection locale={locale} detailed />
            <StyleGuide locale={locale} />
            <FaqSection locale={locale} items={faq} />
          </>
        ) : null}
        {route === "bilingual" ? (
          <>
            <Points locale={locale} route="bilingual" />
            <FactsSection locale={locale} />
            <FaqSection locale={locale} items={faq} />
          </>
        ) : null}
        {route === "rsvp" ? (
          <>
            <Points locale={locale} route="rsvp" />
            <FactsSection locale={locale} />
            <FaqSection locale={locale} items={faq} />
          </>
        ) : null}
        {route === "photographers" ? (
          <>
            <Points locale={locale} route="photographers" />
            <PartnerKitSection locale={locale} />
            <div className="print:hidden">
              <FaqSection locale={locale} items={faq} />
            </div>
          </>
        ) : null}
        <div className="print:hidden">
          <CtaSection locale={locale} />
        </div>
      </main>
      <div className="print:hidden">
        <LandingFooter locale={locale} route={route} />
      </div>
    </>
  );
}
