import { JsonLd } from "@/components/json-ld";
import { operator } from "@/config/operator";
import { pricing } from "@/config/pricing";
import type { Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/pathnames";
import { createTranslator } from "@/i18n/translator";
import { siteUrl } from "@/lib/site";
import {
  breadcrumbLd,
  faqPageLd,
  graph,
  organizationLd,
  softwareApplicationLd,
  websiteLd,
  type Crumb,
} from "@/seo/json-ld";
import { getFaqItems } from "./faq";

/** Strukturovaná data úvodní stránky: Organization, WebSite, SoftwareApplication, FAQPage, BreadcrumbList. */
export function HomeStructuredData({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const name = t("common.brand");
  const description = t("marketing.home.metaDescription");
  const homeUrl = new URL(localizedPath("home", locale), siteUrl).toString();

  return (
    <JsonLd
      data={graph(
        organizationLd({
          siteUrl,
          name,
          description,
          legalName: operator.nameAndId,
          contact: operator.contact,
        }),
        websiteLd({ siteUrl, name, description, locale }),
        softwareApplicationLd({
          siteUrl,
          name,
          description,
          offerDescription: t("landing.pricing.lead"),
          locale,
          pricing,
        }),
        faqPageLd(
          getFaqItems(locale).map((item) => ({ question: item.question, answer: item.answer })),
        ),
        breadcrumbLd([{ name: t("marketing.home.breadcrumb"), url: homeUrl }]),
      )}
    />
  );
}

/** Podstránky: Organization, WebSite a drobečková navigace Úvod > stránka. */
export function SubpageStructuredData({
  locale,
  crumbs,
}: {
  locale: Locale;
  crumbs: readonly Crumb[];
}) {
  const t = createTranslator(locale);
  const name = t("common.brand");
  const description = t("marketing.home.metaDescription");
  return (
    <JsonLd
      data={graph(
        organizationLd({
          siteUrl,
          name,
          description,
          legalName: operator.nameAndId,
          contact: operator.contact,
        }),
        websiteLd({ siteUrl, name, description, locale }),
        breadcrumbLd(crumbs),
      )}
    />
  );
}
