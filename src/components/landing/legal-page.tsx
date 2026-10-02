import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { isLocale, type Locale } from "@/i18n/config";
import type { MessageKey } from "@/i18n/messages";
import { localizedPath } from "@/i18n/pathnames";
import { createTranslator } from "@/i18n/translator";
import { siteUrl } from "@/lib/site";
import { pageMetadata } from "@/seo/page-metadata";
import { LandingFooter } from "./landing-footer";
import { LandingHeader } from "./landing-header";
import { SubpageStructuredData } from "./structured-data";

/**
 * Právní podstránky jsou zatím zástupné (text doplní provozovatel nebo právník) a mají `noindex`:
 * prázdná stránka s názvem „Zpracování osobních údajů“ by v hledání jen škodila. Po doplnění textu
 * se `noindex` zruší a stránka se přidá do `indexableRoutes` v `src/seo/sitemap.ts`.
 *
 * Každá jazyková varianta má vlastní složku (`soukromi`, `privacy`, ...) a stránka ověří, že složka
 * patří jazyku z adresy: `/privacy` česky nebo `/en/soukromi` jsou 404 (žádné duplicity).
 */
export type LegalRoute = "privacy" | "terms" | "accessibility";

const TITLE_KEYS = {
  privacy: "legal.privacy.title",
  terms: "legal.terms.title",
  accessibility: "legal.accessibility.title",
} as const satisfies Record<LegalRoute, MessageKey>;

const META_KEYS = {
  privacy: "legal.privacy.meta",
  terms: "legal.terms.meta",
  accessibility: "legal.accessibility.meta",
} as const satisfies Record<LegalRoute, MessageKey>;

/** Jazyk z adresy, pokud složka `segment` je jeho přeloženou cestou k `route`; jinak `null`. */
function legalLocale(route: LegalRoute, segment: string, localeParam: string): Locale | null {
  if (!isLocale(localeParam)) return null;
  const last = localizedPath(route, localeParam).split("/").pop();
  return last === segment ? localeParam : null;
}

export function legalMetadata(route: LegalRoute, segment: string, localeParam: string): Metadata {
  const locale = legalLocale(route, segment, localeParam);
  if (!locale) return {};
  const t = createTranslator(locale);
  return pageMetadata({
    route,
    locale,
    siteUrl,
    title: `${t(TITLE_KEYS[route])} | ${t("common.brand")}`,
    description: t(META_KEYS[route]),
    siteName: t("common.brand"),
    imageAlt: t("marketing.home.ogAlt"),
    noindex: true,
  });
}

export function LegalPage({
  route,
  segment,
  localeParam,
}: {
  route: LegalRoute;
  segment: string;
  localeParam: string;
}) {
  const locale = legalLocale(route, segment, localeParam);
  if (!locale) notFound();
  const t = createTranslator(locale);
  const home = new URL(localizedPath("home", locale), siteUrl).toString();
  const url = new URL(localizedPath(route, locale), siteUrl).toString();

  return (
    <>
      <SubpageStructuredData
        locale={locale}
        crumbs={[
          { name: t("marketing.home.breadcrumb"), url: home },
          { name: t(TITLE_KEYS[route]), url },
        ]}
      />
      <LandingHeader locale={locale} route={route} />
      <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-8">
        <h1 className="text-ink text-4xl font-medium md:text-5xl">{t(TITLE_KEYS[route])}</h1>
        <p className="text-muted mt-6 text-lg">{t("legal.placeholder")}</p>
        <a href={localizedPath("home", locale)} className={`${buttonVariants()} mt-10`}>
          {t("legal.back")}
        </a>
      </main>
      <LandingFooter locale={locale} route={route} />
    </>
  );
}
