import type { Metadata } from "next";
import { articlePath, articleState } from "@/blog/article";
import { allArticles, canWriteArticles } from "@/blog/store";
import { buttonVariants } from "@/components/ui/button";
import { localePath, localeShortNames, locales } from "@/i18n/config";
import { siteUrl } from "@/lib/site";
import { getOpsTranslator } from "@/ops/i18n";
import { requireOperator } from "@/ops/session";
import { OpsShell, TableRegion, tableClass, tdClass, thClass } from "@/ops/ui/shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getOpsTranslator();
  return { title: t("ops.blog.title") };
}

const linkClass = "text-pine inline-flex min-h-[2.75rem] items-center underline underline-offset-4";

/** Seznam článků blogu (jen majitel). Úpravy jen lokálně, viz `src/blog/store.ts`. */
export default async function BlogAdminPage() {
  const t = await getOpsTranslator();
  const session = await requireOperator("blog");
  const articles = allArticles();

  return (
    <OpsShell session={session} current="blog" title={t("ops.blog.title")}>
      <p className="mb-4 max-w-prose">{t("ops.blog.intro")}</p>
      {canWriteArticles ? (
        <a href={localePath("/blog/novy", t.locale)} className={`${buttonVariants()} mb-8`}>
          {t("ops.blog.new")}
        </a>
      ) : (
        <p className="bg-linen rounded-button mb-8 max-w-prose p-4 font-medium">
          {t("ops.blog.readOnly")}
        </p>
      )}

      {articles.length === 0 ? (
        <p>{t("ops.blog.empty")}</p>
      ) : (
        <TableRegion label={t("ops.blog.caption")}>
          <table className={tableClass}>
            <caption className="sr-only">{t("ops.blog.caption")}</caption>
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  {t("ops.blog.col.title")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.blog.col.status")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.blog.col.published")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.blog.col.updated")}
                </th>
                <th scope="col" className={thClass}>
                  {t("ops.blog.col.links")}
                </th>
              </tr>
            </thead>
            <tbody>
              {articles.map((article) => {
                const state = articleState(article);
                return (
                  <tr key={article.id}>
                    <th scope="row" className={`${tdClass} font-medium`}>
                      <a href={localePath(`/blog/${article.id}`, t.locale)} className={linkClass}>
                        {article.translations.cs.title}
                      </a>
                    </th>
                    <td className={tdClass}>
                      {state === "scheduled"
                        ? t("ops.blog.status.scheduled", { date: article.publishedAt })
                        : t(
                            state === "published"
                              ? "ops.blog.status.published"
                              : "ops.blog.status.draft",
                          )}
                    </td>
                    <td className={tdClass}>{article.publishedAt}</td>
                    <td className={tdClass}>{article.updatedAt}</td>
                    <td className={tdClass}>
                      {state === "published" ? (
                        <span className="flex gap-3">
                          {locales.map((locale) => (
                            <a
                              key={locale}
                              href={new URL(articlePath(article, locale), siteUrl).toString()}
                              className={linkClass}
                              lang={locale}
                            >
                              {localeShortNames[locale]}
                            </a>
                          ))}
                        </span>
                      ) : (
                        t("ops.none")
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableRegion>
      )}
    </OpsShell>
  );
}
