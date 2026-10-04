import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import { Document } from "@/components/document";
import { SkipLink } from "@/components/ui/skip-link";
import { htmlLang, isLocale, locales } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { siteUrl } from "@/lib/site";
import "./transitions.css";

// Písmo nadpisů úvodního webu (`font-display`). Jen tady, aby ho weby párů ani správa nestahovaly.
const fraunces = Fraunces({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  // Výchozí název pro stránky bez vlastního (např. 404); stránky ho přepisují.
  title: "Se vezmou",
};

// Jen `cs` a `en`; jiná hodnota je 404 a stránky se vykreslí při sestavení.
export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

/** Kořenový layout úvodní stránky (`se-vezmou.cz`). */
export default async function MarketingLayout({
  children,
  params,
}: LayoutProps<"/h/marketing/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  const t = await getTranslator(locale, ["common"]);

  return (
    <Document lang={htmlLang[locale]} className={fraunces.variable}>
      <SkipLink target="#obsah">{t("common.skipToContent")}</SkipLink>
      {children}
    </Document>
  );
}
