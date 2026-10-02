import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { isLocale } from "@/i18n/config";
import { hreflangAlternates } from "@/i18n/pathnames";
import { createTranslator } from "@/i18n/translator";
import { siteUrl } from "@/lib/site";

export async function generateMetadata({
  params,
}: PageProps<"/h/marketing/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return {
    title: t("marketing.home.metaTitle"),
    description: t("marketing.home.metaDescription"),
    // `canonical` na sebe, `hreflang` cs, en a x-default (česká verze).
    alternates: hreflangAlternates("home", locale, siteUrl),
  };
}

/** Zástupná úvodní stránka; skutečný obsah přijde v M2. */
export default async function MarketingHome({ params }: PageProps<"/h/marketing/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  const t = createTranslator(locale);

  return (
    <>
      <SiteHeader locale={locale} route="home" />
      <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-8">
        <h1 className="text-ink text-5xl font-medium sm:text-6xl">{t("marketing.home.title")}</h1>
        <p className="text-muted mt-6 max-w-prose text-xl">{t("marketing.home.lead")}</p>
      </main>
    </>
  );
}
