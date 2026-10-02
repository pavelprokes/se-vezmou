import type { Metadata } from "next";
import { getUiLocale } from "@/auth/request";
import { Document } from "@/components/document";
import { SkipLink } from "@/components/ui/skip-link";
import { htmlLang } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";

export const metadata: Metadata = {
  title: { default: "Se vezmou", template: "%s | Se vezmou" },
  robots: { index: false, follow: false },
};

/**
 * Kořenový layout `app.se-vezmou.cz`. Jazyk rozhraní správy: čeština, angličtina podle
 * `Accept-Language` (bez cookie). Čtení hlaviček dělá všechny stránky správy dynamické, což je
 * u relací správné (nic z nich se nesmí sdílet v mezipaměti).
 */
export default async function AppLayout({ children }: LayoutProps<"/h/app">) {
  const locale = await getUiLocale();
  const t = createTranslator(locale);
  return (
    <Document lang={htmlLang[locale]}>
      <SkipLink target="#obsah">{t("common.skipToContent")}</SkipLink>
      {children}
    </Document>
  );
}
