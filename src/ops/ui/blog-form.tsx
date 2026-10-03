"use client";

import { Field, Fieldset } from "@/components/ui/field";
import { TextArea } from "@/components/ui/textarea";
import type { Article } from "@/blog/article";
import { localeNames, locales } from "@/i18n/config";
import { saveArticleAction } from "../actions/blog";
import { ActionForm } from "./action-form";
import { SelectField, type SelectOption } from "./select-field";

/** Formulář článku blogu: společné údaje a pak každá jazyková verze ve vlastní skupině polí. */
export function BlogArticleForm({
  article,
  errors,
  statuses,
  labels,
}: {
  /** Upravovaný článek; bez něj se zakládá nový. */
  article?: Article;
  errors: Record<string, string>;
  statuses: SelectOption[];
  labels: {
    id: string;
    idHint: string;
    status: string;
    publishedAt: string;
    updatedAt: string;
    slug: string;
    slugHint: string;
    title: string;
    titleHint: string;
    description: string;
    descriptionHint: string;
    body: string;
    bodyHint: string;
    submit: string;
    success: string;
  };
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm
      action={saveArticleAction}
      submitLabel={labels.submit}
      successText={labels.success}
      errors={errors}
      hiddenFields={{ mode: article ? "edit" : "create" }}
    >
      {(form) => {
        const value = (name: string, fallback = "") => form.value(name) ?? fallback;
        return (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                id={form.id("id")}
                name="id"
                label={labels.id}
                hint={labels.idHint}
                error={form.error("id")}
                defaultValue={value("id", article?.id)}
                readOnly={Boolean(article)}
                autoComplete="off"
                spellCheck={false}
                required
              />
              <SelectField
                id={form.id("status")}
                name="status"
                label={labels.status}
                options={statuses}
                error={form.error("status")}
                defaultValue={value("status", article?.status ?? "draft")}
              />
              <Field
                id={form.id("publishedAt")}
                name="publishedAt"
                type="date"
                label={labels.publishedAt}
                error={form.error("publishedAt")}
                defaultValue={value("publishedAt", article?.publishedAt ?? today)}
                required
              />
              <Field
                id={form.id("updatedAt")}
                name="updatedAt"
                type="date"
                label={labels.updatedAt}
                error={form.error("updatedAt")}
                defaultValue={value("updatedAt", article?.updatedAt ?? today)}
                required
              />
            </div>
            {locales.map((locale) => {
              const current = article?.translations[locale];
              const name = (field: string) => `${locale}.${field}`;
              return (
                <Fieldset
                  key={locale}
                  legend={localeNames[locale]}
                  className="border-hairline rounded-2xl border p-5"
                >
                  <div className="flex flex-col gap-4">
                    <Field
                      id={form.id(name("title"))}
                      name={name("title")}
                      lang={locale}
                      label={labels.title}
                      hint={labels.titleHint}
                      error={form.error(name("title"))}
                      defaultValue={value(name("title"), current?.title)}
                      required
                    />
                    <Field
                      id={form.id(name("slug"))}
                      name={name("slug")}
                      label={labels.slug}
                      hint={labels.slugHint}
                      error={form.error(name("slug"))}
                      defaultValue={value(name("slug"), current?.slug)}
                      autoComplete="off"
                      spellCheck={false}
                      required
                    />
                    <TextArea
                      id={form.id(name("description"))}
                      name={name("description")}
                      lang={locale}
                      label={labels.description}
                      hint={labels.descriptionHint}
                      error={form.error(name("description"))}
                      defaultValue={value(name("description"), current?.description)}
                      rows={3}
                      required
                    />
                    <TextArea
                      id={form.id(name("body"))}
                      name={name("body")}
                      lang={locale}
                      label={labels.body}
                      hint={labels.bodyHint}
                      error={form.error(name("body"))}
                      defaultValue={value(name("body"), current?.body)}
                      rows={24}
                      className="font-mono"
                      required
                    />
                  </div>
                </Fieldset>
              );
            })}
          </>
        );
      }}
    </ActionForm>
  );
}
