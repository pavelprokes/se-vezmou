import type { Metadata } from "next";
import { getUiLocale } from "@/auth/request";
import { PreviewHost } from "@/components/wizard/preview-host";
import { createTranslator } from "@/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: createTranslator(await getUiLocale())("wizard.preview.title"),
    robots: { index: false, follow: false },
  };
}

/**
 * Rámec živého náhledu v průvodci. Je to skutečný dokument (šířka telefonu nebo počítače podle
 * rámce), do kterého průvodce zprávou posílá obsah konceptu. Nic nečte z databáze ani z úložiště.
 */
export default async function PreviewFramePage() {
  const t = createTranslator(await getUiLocale());
  return <PreviewHost waiting={t("wizard.preview.waiting")} />;
}
