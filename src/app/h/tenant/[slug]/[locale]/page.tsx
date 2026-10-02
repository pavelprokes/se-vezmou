import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";
import { tenantExists } from "@/tenant/resolve";

export default async function TenantPlaceholder({
  params,
}: PageProps<"/h/tenant/[slug]/[locale]">) {
  const { slug, locale } = await params;
  if (!isLocale(locale) || !tenantExists(slug)) notFound();
  const t = createTranslator(locale);

  return (
    <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-8">
      <h1 className="text-ink text-4xl font-medium">{t("placeholder.tenant.title")}</h1>
      <p className="text-muted mt-4 max-w-prose text-lg">{t("placeholder.tenant.body")}</p>
    </main>
  );
}
