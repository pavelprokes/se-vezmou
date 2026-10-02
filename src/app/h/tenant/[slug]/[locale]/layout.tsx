import type { Metadata } from "next";
import { Document } from "@/components/document";
import { SkipLink } from "@/components/ui/skip-link";
import { htmlLang, isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";

export const metadata: Metadata = {
  title: "Se vezmou",
  robots: { index: false, follow: false },
};

/** Kořenový layout webu páru (`<slug>.se-vezmou.cz`); bez měření návštěvnosti (soukromí hostů). */
export default async function TenantLayout({
  children,
  params,
}: LayoutProps<"/h/tenant/[slug]/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  const t = createTranslator(locale);

  return (
    <Document lang={htmlLang[locale]} measure={false}>
      <SkipLink target="#obsah">{t("common.skipToContent")}</SkipLink>
      {children}
    </Document>
  );
}
