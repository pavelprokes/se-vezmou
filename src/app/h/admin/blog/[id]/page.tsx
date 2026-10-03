import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canWriteArticles, findArticle } from "@/blog/store";
import { localePath } from "@/i18n/config";
import { getOpsTranslator } from "@/ops/i18n";
import { requireOperator } from "@/ops/session";
import { BlogArticleForm } from "@/ops/ui/blog-form";
import { OpsShell } from "@/ops/ui/shell";

/** `/blog/novy` zakládá nový článek, jinak se upravuje článek podle identifikátoru. */
const NEW = "novy";

export async function generateMetadata({
  params,
}: PageProps<"/h/admin/blog/[id]">): Promise<Metadata> {
  const { id } = await params;
  const t = await getOpsTranslator();
  return { title: t(id === NEW ? "ops.blog.create.title" : "ops.blog.edit.title") };
}

export default async function BlogArticleAdminPage({ params }: PageProps<"/h/admin/blog/[id]">) {
  const { id } = await params;
  const t = await getOpsTranslator();
  const session = await requireOperator("blog");
  const article = id === NEW ? undefined : findArticle(id);
  if (id !== NEW && !article) notFound();

  return (
    <OpsShell
      session={session}
      current="blog"
      path={`/blog/${id}`}
      title={
        article
          ? `${t("ops.blog.edit.title")}: ${article.translations.cs.title}`
          : t("ops.blog.create.title")
      }
    >
      <a
        href={localePath("/blog", t.locale)}
        className="text-pine mb-6 inline-flex min-h-[2.75rem] items-center underline underline-offset-4"
      >
        {t("ops.blog.back")}
      </a>
      {canWriteArticles ? null : (
        <p className="bg-linen rounded-button mb-6 max-w-prose p-4 font-medium">
          {t("ops.blog.readOnly")}
        </p>
      )}
      <div className="max-w-4xl">
        <BlogArticleForm
          article={article}
          errors={{
            forbidden: t("ops.error.forbidden"),
            session: t("ops.error.session"),
            origin: t("ops.error.origin"),
            notFound: t("ops.error.notFound"),
            blogInvalid: t("ops.error.blogInvalid"),
            blogExists: t("ops.error.blogExists"),
            blogReadOnly: t("ops.error.blogReadOnly"),
            generic: t("ops.error.generic"),
          }}
          statuses={[
            { value: "draft", label: t("ops.blog.status.draft") },
            { value: "published", label: t("ops.blog.status.published") },
          ]}
          labels={{
            id: t("ops.blog.field.id"),
            idHint: t("ops.blog.field.idHint"),
            status: t("ops.blog.field.status"),
            publishedAt: t("ops.blog.field.publishedAt"),
            updatedAt: t("ops.blog.field.updatedAt"),
            slug: t("ops.blog.field.slug"),
            slugHint: t("ops.blog.field.slugHint"),
            title: t("ops.blog.field.title"),
            titleHint: t("ops.blog.field.titleHint"),
            description: t("ops.blog.field.description"),
            descriptionHint: t("ops.blog.field.descriptionHint"),
            body: t("ops.blog.field.body"),
            bodyHint: t("ops.blog.field.bodyHint"),
            submit: t("ops.blog.submit"),
            success: t("ops.blog.saved"),
          }}
        />
      </div>
    </OpsShell>
  );
}
