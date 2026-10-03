import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { articlePath, readingMinutes } from "@/blog/article";
import { publishedArticles } from "@/blog/store";
import { articleDate } from "@/components/blog/article-body";
import { CtaSection } from "@/components/landing/cta-section";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { SubpageStructuredData } from "@/components/landing/structured-data";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { isLocale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { localizedPath } from "@/i18n/pathnames";
import { typo } from "@/i18n/typo";
import { siteUrl } from "@/lib/site";
import { pageMetadata } from "@/seo/page-metadata";

export async function generateMetadata({
  params,
}: PageProps<"/h/marketing/[locale]/blog">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslator(locale, ["common", "blog", "marketing"]);
  return pageMetadata({
    route: "blog",
    locale,
    siteUrl,
    title: t("blog.index.metaTitle"),
    description: t("blog.index.metaDescription"),
    siteName: t("common.brand"),
    imageAlt: t("marketing.home.ogAlt"),
  });
}

/** Rozcestník blogu: zveřejněné články od nejnovějšího, ve stylu sekcí úvodní stránky. */
export default async function BlogIndex({ params }: PageProps<"/h/marketing/[locale]/blog">) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  const t = await getTranslator(locale, ["blog", "marketing"]);
  const articles = publishedArticles();
  const absolute = (path: string) => new URL(path, siteUrl).toString();

  return (
    <>
      <SubpageStructuredData
        locale={locale}
        crumbs={[
          { name: t("marketing.home.breadcrumb"), url: absolute(localizedPath("home", locale)) },
          { name: t("blog.breadcrumb"), url: absolute(localizedPath("blog", locale)) },
        ]}
      />
      <LandingHeader locale={locale} route="blog" />
      <main id="obsah" tabIndex={-1}>
        <section aria-labelledby="blog-title" className="bg-parchment text-ink">
          <div className="mx-auto w-full max-w-6xl px-4 pt-8 pb-16 sm:px-8 md:pt-16 md:pb-24">
            <p className="text-cinnamon-deep text-sm font-bold tracking-widest uppercase">
              {t("blog.index.eyebrow")}
            </p>
            <h1
              id="blog-title"
              className="mt-4 max-w-3xl text-5xl leading-[1.05] font-medium tracking-tight text-balance md:text-6xl"
            >
              {t("blog.index.title")}
            </h1>
            <p className="text-muted mt-6 max-w-2xl text-lg text-pretty">{t("blog.index.lead")}</p>

            {articles.length === 0 ? (
              <p className="mt-12 text-lg">{t("blog.index.empty")}</p>
            ) : (
              <ul
                aria-label={t("blog.index.listLabel")}
                className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3"
              >
                {articles.map((article) => {
                  const text = article.translations[locale];
                  const href = articlePath(article, locale);
                  return (
                    <li key={article.id} className="flex">
                      <Card as="article" className="flex w-full flex-col">
                        <p className="text-muted text-sm">
                          <time dateTime={article.publishedAt}>
                            {t("blog.meta", {
                              date: articleDate(article.publishedAt, locale),
                              minutes: readingMinutes(text.body),
                            })}
                          </time>
                        </p>
                        <h2 className="mt-3 font-sans text-2xl leading-tight font-bold tracking-tight text-balance">
                          <a
                            href={href}
                            className="hover:text-pine underline-offset-4 hover:underline"
                          >
                            {typo(text.title, locale)}
                          </a>
                        </h2>
                        <p className="text-muted mt-3 flex-1 text-pretty">
                          {typo(text.description, locale)}
                        </p>
                        <a
                          href={href}
                          aria-label={t("blog.readMoreLabel", { title: text.title })}
                          className="min-h-target text-pine mt-5 inline-flex items-center gap-2 self-start font-medium underline underline-offset-4"
                        >
                          {t("blog.readMore")}
                          <Icon icon={ArrowRight} size={18} />
                        </a>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
        <CtaSection locale={locale} />
      </main>
      <LandingFooter locale={locale} route="blog" />
    </>
  );
}
