import type { Metadata } from "next";
import { getUiLocale } from "@/auth/request";
import { PreviewHost } from "@/components/wizard/preview-host";
import { SITE_NAMESPACES, type SiteNamespace } from "@/components/site/context";
import { locales, type Locale } from "@/i18n/config";
import { getTranslator, loadMessages } from "@/i18n/load";
import type { LoadedMessages } from "@/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslator(await getUiLocale(), ["wizard"]))("wizard.preview.title"),
    robots: { index: false, follow: false },
  };
}

/**
 * Rámec živého náhledu v průvodci. Je to skutečný dokument (šířka telefonu nebo počítače podle
 * rámce), do kterého průvodce zprávou posílá obsah konceptu. Nic nečte z databáze ani z úložiště.
 */
export default async function PreviewFramePage() {
  const t = await getTranslator(await getUiLocale(), ["wizard"]);
  // Web páru se v náhledu ukazuje v jazyce webu, ne rozhraní: zprávy webu pro každý jazyk.
  const messages = Object.fromEntries(
    await Promise.all(
      locales.map(async (locale) => [locale, await loadMessages(locale, SITE_NAMESPACES)] as const),
    ),
  ) as Record<Locale, LoadedMessages<SiteNamespace>>;
  return <PreviewHost waiting={t("wizard.preview.waiting")} messages={messages} />;
}
