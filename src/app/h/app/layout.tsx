import type { Metadata } from "next";
import { getUiLocale } from "@/auth/request";
import { Document } from "@/components/document";
import { SkipLink } from "@/components/ui/skip-link";
import { htmlLang } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { siteUrl } from "@/lib/site";
import { OG_IMAGE_SIZE, ogImagePath } from "@/seo/page-metadata";

export const metadata: Metadata = {
  title: { default: "Se vezmou", template: "%s | Se vezmou" },
  description: "Svatební web pro vaše hosty, česky i anglicky.",
  robots: { index: false, follow: false },
  // Sdílený odkaz na přihlášení nebo průvodce ukáže obecný obrázek webu (absolutní adresa úvodní stránky).
  openGraph: {
    type: "website",
    siteName: "Se vezmou",
    images: [{ url: `${siteUrl}${ogImagePath("cs")}`, ...OG_IMAGE_SIZE, alt: "Se vezmou" }],
  },
  twitter: { card: "summary_large_image" },
};

/**
 * Kořenový layout `app.se-vezmou.cz`. Jazyk rozhraní správy určuje cesta: česky bez předpony,
 * anglicky pod `/en` (bez cookie a bez `Accept-Language`). Čtení hlaviček dělá všechny stránky správy dynamické, což je
 * u relací správné (nic z nich se nesmí sdílet v mezipaměti).
 */
export default async function AppLayout({ children }: LayoutProps<"/h/app">) {
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["common"]);
  return (
    <Document lang={htmlLang[locale]}>
      <SkipLink target="#obsah">{t("common.skipToContent")}</SkipLink>
      {children}
    </Document>
  );
}
