"use server";

import { redirect } from "next/navigation";
import { getUiLocale } from "@/auth/request";
import { articleSchema } from "@/blog/article";
import { canWriteArticles, findArticle, writeArticle } from "@/blog/store";
import { localePath, locales } from "@/i18n/config";
import { authorizeOperator } from "../session";
import type { ActionState } from "../ui/action-form";

/**
 * Uložení článku blogu do `content/blog/<id>.json` (jen majitel, jen lokálně: na Vercelu jde
 * souborový systém jen číst). Do produkce jde článek commitem a nasazením, ne z administrace.
 * Pole formuláře: `mode` (`create`/`edit`), `id`, `status`, `publishedAt`, `updatedAt`
 * a za každý jazyk `<jazyk>.slug`, `<jazyk>.title`, `<jazyk>.description`, `<jazyk>.body`.
 */

const TEXT_FIELDS = ["slug", "title", "description", "body"] as const;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function saveArticleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorizeOperator("blog");
  if (!auth.ok) return { error: auth.reason };

  const names = [
    "mode",
    "id",
    "status",
    "publishedAt",
    "updatedAt",
    ...locales.flatMap((l) => TEXT_FIELDS.map((f) => `${l}.${f}`)),
  ];
  const values = Object.fromEntries(names.map((name) => [name, text(formData, name)]));
  if (!canWriteArticles) return { error: "blogReadOnly", values };

  const parsed = articleSchema.safeParse({
    id: values.id.trim(),
    status: values.status,
    publishedAt: values.publishedAt,
    updatedAt: values.updatedAt,
    translations: Object.fromEntries(
      locales.map((l) => [
        l,
        Object.fromEntries(TEXT_FIELDS.map((f) => [f, values[`${l}.${f}`].trim()])),
      ]),
    ),
  });
  if (!parsed.success) {
    // `translations.cs.title` -> pole `cs.title`.
    const path = parsed.error.issues[0]?.path.filter((p) => p !== "translations").join(".");
    return { error: "blogInvalid", field: path || undefined, values };
  }

  const creating = values.mode === "create";
  const existing = findArticle(parsed.data.id);
  if (creating && existing) return { error: "blogExists", field: "id", values };
  if (!creating && !existing) return { error: "notFound", values };

  try {
    writeArticle(parsed.data);
  } catch {
    return { error: "generic", values };
  }
  if (creating) redirect(localePath(`/blog/${parsed.data.id}`, await getUiLocale()));
  return { ok: true };
}
