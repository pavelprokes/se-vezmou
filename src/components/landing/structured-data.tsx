import { JsonLd } from "@/components/json-ld";
import { operator } from "@/config/operator";
import { pricing } from "@/config/pricing";
import type { Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/pathnames";
import { getTranslator } from "@/i18n/load";
import { siteUrl } from "@/lib/site";
import {
  breadcrumbLd,
  faqPageLd,
  graph,
  organizationLd,
  serviceLd,
  softwareApplicationLd,
  websiteLd,
  type Crumb,
  type JsonLdNode,
} from "@/seo/json-ld";
import { getFaqItems } from "./faq";

/** Společné vstupy pro uzly `SoftwareApplication` a `Service` (jedna cena, jeden text nabídky) na všech stránkách. */
export async function getOfferInput(locale: Locale) {
  const t = await getTranslator(locale, ["common", "landing", "marketing"]);
  return {
    siteUrl,
    name: t("common.brand"),
    description: t("marketing.home.metaDescription"),
    offerDescription: t("landing.pricing.lead"),
    serviceType: t("marketing.service.type"),
    locale,
    pricing,
  };
}

/** Strukturovaná data úvodní stránky: Organization, WebSite, SoftwareApplication, FAQPage, BreadcrumbList. */
export async function HomeStructuredData({ locale }: { locale: Locale }) {
  const t = await getTranslator(locale, ["common", "landing", "marketing"]);
  const faq = await getFaqItems(locale);
  const name = t("common.brand");
  const description = t("marketing.home.metaDescription");
  const homeUrl = new URL(localizedPath("home", locale), siteUrl).toString();

  const offerInput = await getOfferInput(locale);

  return (
    <JsonLd
      data={graph(
        organizationLd({
          siteUrl,
          name,
          description,
          alternateName: "se-vezmou.cz",
          legalName: operator.legalName,
          companyId: operator.companyId,
          contact: operator.contact,
          profiles: operator.profiles,
        }),
        websiteLd({ siteUrl, name, description, locale }),
        softwareApplicationLd(offerInput),
        serviceLd(offerInput),
        faqPageLd(faq.map((item) => ({ question: item.question, answer: item.answer }))),
        breadcrumbLd([{ name: t("marketing.home.breadcrumb"), url: homeUrl }]),
      )}
    />
  );
}

/** Podstránky: Organization, WebSite, drobečková navigace Úvod > stránka a případně další uzly (článek). */
export async function SubpageStructuredData({
  locale,
  crumbs,
  extra = [],
}: {
  locale: Locale;
  crumbs: readonly Crumb[];
  extra?: readonly JsonLdNode[];
}) {
  const t = await getTranslator(locale, ["common", "landing", "marketing"]);
  const name = t("common.brand");
  const description = t("marketing.home.metaDescription");
  return (
    <JsonLd
      data={graph(
        organizationLd({
          siteUrl,
          name,
          description,
          alternateName: "se-vezmou.cz",
          legalName: operator.legalName,
          companyId: operator.companyId,
          contact: operator.contact,
          profiles: operator.profiles,
        }),
        websiteLd({ siteUrl, name, description, locale }),
        breadcrumbLd(crumbs),
        ...extra,
      )}
    />
  );
}
