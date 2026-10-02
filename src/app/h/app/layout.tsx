import type { Metadata } from "next";
import { Document } from "@/components/document";
import { SkipLink } from "@/components/ui/skip-link";
import { htmlLang } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";

export const metadata: Metadata = {
  title: "Se vezmou",
  robots: { index: false, follow: false },
};

/** Kořenový layout `app.se-vezmou.cz`. Jazyk rozhraní správy zatím jen čeština (M4+). */
export default function AppLayout({ children }: LayoutProps<"/h/app">) {
  const t = createTranslator("cs");
  return (
    <Document lang={htmlLang.cs}>
      <SkipLink target="#obsah">{t("common.skipToContent")}</SkipLink>
      {children}
    </Document>
  );
}
