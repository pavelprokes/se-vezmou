import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { articlePath, articlePaths, readingMinutes } from "@/blog/article";
import { parseBlocks } from "@/blog/markdown";
import { findPublishedBySlug, publishedArticles } from "@/blog/store";
import { ArticleBody, articleDate } from "@/components/blog/article-body";
import { CtaSection } from "@/components/landing/cta-section";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { SubpageStructuredData } from "@/components/landing/structured-data";
import { Icon } from "@/components/ui/icon";
import { isLocale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { localizedPath } from "@/i18n/pathnames";
import { typo } from "@/i18n/typo";
import { siteUrl } from "@/lib/site";
import { blogPostingLd } from "@/seo/json-ld";
import { ogImagePath, pageMetadata } from "@/seo/page-metadata";

type Props = PageProps<"/h/marketing/[locale]/blog/[slug]">;

// Jen zveřejněné články v jazyce adresy; cizí nebo neznámý slug je 404 (žádné duplicity).
export const dynamicParams = false;

export function generateStaticParams({ params }: { params: { locale: string } }) {
  const locale = params.locale;
  if (!isLocale(locale)) return [];
  return publishedArticles().map((article) => ({ slug: article.translations[locale].slug }));
}

async function load(props: Props) {
  const { locale, slug } = await props.params;
  if (!isLocale(locale)) return null;
  const article = findPublishedBySlug(locale, slug);
  return article ? { locale, article, text: article.translations[locale] } : null;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const found = await load(props);
  if (!found) return {};
  const { locale, article, text } = found;
  const t = await getTranslator(locale, ["common"]);
  return pageMetadata({
    route: articlePaths(article),
    locale,
    siteUrl,
    title: `${text.title} | ${t("common.brand")}`,
    description: text.description,
    siteName: t("common.brand"),
    imageAlt: text.title,
    article: { publishedTime: article.publishedAt, modifiedTime: article.updatedAt },
  });
}

/** Článek blogu: nadpis, datum a doba čtení, obsah článku (od tří kapitol), text a výzva. */
export default async function BlogArticle(props: Props) {
  const found = await load(props);
  if (!found) notFound();
  const { locale, article, text } = found;
  const t = await getTranslator(locale, ["blog", "marketing"]);
  const blocks = parseBlocks(text.body);
  const chapters = blocks.flatMap((block) => (block.type === "h2" ? [block] : []));
  const absolute = (path: string) => new URL(path, siteUrl).toString();
  const url = absolute(articlePath(article, locale));
  const blogHref = localizedPath("blog", locale);
  const others = publishedArticles()
    .filter((other) => other.id !== article.id)
    .slice(0, 2);

  return (
    <>
      <SubpageStructuredData
        locale={locale}
        crumbs={[
          { name: t("marketing.home.breadcrumb"), url: absolute(localizedPath("home", locale)) },
          { name: t("blog.breadcrumb"), url: absolute(blogHref) },
          { name: text.title, url },
        ]}
        extra={[
          blogPostingLd({
            siteUrl,
            url,
            headline: text.title,
            description: text.description,
            locale,
            datePublished: article.publishedAt,
            dateModified: article.updatedAt,
            imageUrl: absolute(ogImagePath(locale)),
          }),
        ]}
      />
      <LandingHeader locale={locale} route={articlePaths(article)} />
      <main id="obsah" tabIndex={-1}>
        <article aria-labelledby="article-title" className="bg-parchment text-ink">
          <div className="mx-auto w-full max-w-3xl px-4 pt-8 pb-16 sm:px-8 md:pt-16 md:pb-24">
            <a
              href={blogHref}
              className="min-h-target text-cinnamon-deep rounded-button hover:bg-linen -mx-2 inline-flex items-center gap-2 px-2 text-sm font-bold tracking-widest uppercase"
            >
              <Icon icon={ArrowLeft} size={16} />
              {t("blog.back")}
            </a>
            <h1
              id="article-title"
              className="mt-4 text-4xl leading-[1.08] font-medium tracking-tight text-balance md:text-5xl lg:text-6xl"
            >
              {typo(text.title, locale)}
            </h1>
            <p className="text-muted mt-6 text-xl text-pretty">{typo(text.description, locale)}</p>
            <p className="text-muted border-hairline mt-6 border-t pt-4 text-sm">
              <time dateTime={article.publishedAt}>
                {t("blog.meta", {
                  date: articleDate(article.publishedAt, locale),
                  minutes: readingMinutes(text.body),
                })}
              </time>
              {article.updatedAt !== article.publishedAt ? (
                <>
                  {" · "}
                  <time dateTime={article.updatedAt}>
                    {t("blog.updated", { date: articleDate(article.updatedAt, locale) })}
                  </time>
                </>
              ) : null}
            </p>

            {chapters.length >= 3 ? (
              <nav
                aria-labelledby="toc-title"
                className="bg-warm border-hairline mt-10 rounded-2xl border p-6"
              >
                <h2 id="toc-title" className="font-sans text-lg font-bold">
                  {t("blog.toc")}
                </h2>
                <ol className="marker:text-pine mt-3 flex list-decimal flex-col gap-1 pl-6">
                  {chapters.map((chapter) => (
                    <li key={chapter.id} className="pl-1">
                      <a
                        href={`#${chapter.id}`}
                        className="text-ink hover:text-pine inline-flex min-h-[2.25rem] items-center underline underline-offset-4"
                      >
                        {typo(chapter.text, locale)}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            ) : null}

            <div className="mt-10">
              <ArticleBody blocks={blocks} locale={locale} />
            </div>
          </div>
        </article>

        {others.length > 0 ? (
          <section aria-labelledby="more-title" className="bg-warm text-ink">
            <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8">
              <h2 id="more-title" className="font-sans text-3xl font-bold tracking-tight">
                {t("blog.more")}
              </h2>
              <ul className="mt-8 grid gap-6 md:grid-cols-2">
                {others.map((other) => (
                  <li key={other.id}>
                    <a
                      href={articlePath(other, locale)}
                      className="border-hairline bg-parchment hover:border-pine block h-full rounded-2xl border p-6"
                    >
                      <span className="block font-sans text-xl leading-tight font-bold underline-offset-4">
                        {typo(other.translations[locale].title, locale)}
                      </span>
                      <span className="text-muted mt-2 block text-pretty">
                        {typo(other.translations[locale].description, locale)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <CtaSection locale={locale} />
      </main>
      <LandingFooter locale={locale} route={articlePaths(article)} />
    </>
  );
}
