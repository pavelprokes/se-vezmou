import { createTranslator } from "@/i18n/translator";

export default function AdminPlaceholder() {
  const t = createTranslator("cs");
  return (
    <main id="obsah" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-8">
      <h1 className="text-ink text-4xl font-medium">{t("placeholder.admin.title")}</h1>
      <p className="text-muted mt-4 max-w-prose text-lg">{t("placeholder.admin.body")}</p>
    </main>
  );
}
