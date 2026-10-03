import type { Metadata } from "next";
import { Document } from "@/components/document";
import { SkipLink } from "@/components/ui/skip-link";
import { getUiLocale } from "@/auth/request";
import { htmlLang } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";

export const metadata: Metadata = {
  title: { default: "Se vezmou, provoz", template: "%s | Se vezmou, provoz" },
  robots: { index: false, follow: false },
};

/**
 * Kořenový layout `admin.se-vezmou.cz` (provozní administrace; jazyk z adresy: výchozí bez předpony,
 * ostatní pod `/<jazyk>`, ADR 0013). Bez měření návštěvnosti
 * (`measure={false}`): do služeb třetích stran nemá z administrace odcházet nic. Čtení cookie relace
 * dělá všechny stránky dynamické, což je u relací správné (nic z nich se nesmí sdílet v mezipaměti).
 */
export default async function AdminLayout({ children }: LayoutProps<"/h/admin">) {
  const locale = await getUiLocale();
  const t = await getTranslator(locale, ["common"]);
  return (
    <Document lang={htmlLang[locale]} measure={false}>
      <SkipLink target="#obsah">{t("common.skipToContent")}</SkipLink>
      {children}
    </Document>
  );
}
