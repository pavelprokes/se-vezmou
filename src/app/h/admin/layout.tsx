import type { Metadata } from "next";
import { Document } from "@/components/document";
import { SkipLink } from "@/components/ui/skip-link";
import { htmlLang } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";

export const metadata: Metadata = {
  title: { default: "Se vezmou, provoz", template: "%s | Se vezmou, provoz" },
  robots: { index: false, follow: false },
};

/**
 * Kořenový layout `admin.se-vezmou.cz` (provozní administrace, jen česky). Bez měření návštěvnosti
 * (`measure={false}`): do služeb třetích stran nemá z administrace odcházet nic. Čtení cookie relace
 * dělá všechny stránky dynamické, což je u relací správné (nic z nich se nesmí sdílet v mezipaměti).
 */
export default function AdminLayout({ children }: LayoutProps<"/h/admin">) {
  const t = createTranslator("cs");
  return (
    <Document lang={htmlLang.cs} measure={false}>
      <SkipLink target="#obsah">{t("common.skipToContent")}</SkipLink>
      {children}
    </Document>
  );
}
