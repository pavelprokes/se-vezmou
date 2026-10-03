import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Eye } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { SiteRenderer } from "@/components/site/site-renderer";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/translator";
import { getPreviewContent } from "@/site/content";

type Props = PageProps<"/h/tenant/[slug]/[locale]/nahled/[token]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: createTranslator(isLocale(locale) ? locale : "cs")("wizard.preview.meta"),
    // Koncept se nesmí indexovat ani sdílet jako odkaz s náhledem (FR-WZ-5).
    robots: { index: false, follow: false },
  };
}

/**
 * Náhled neveřejného konceptu podle neuhádnutelného odkazu (FR-WZ-5, `resolve_preview`). Každá
 * neshoda (adresa, token, jazyk, koncept bez dat) je stejná 404 jako neexistující web.
 * Hlavičky `noindex` a `no-store` přidává proxy; stránka se vykresluje za běhu.
 */
export default async function PreviewPage({ params }: Props) {
  await connection();
  const { slug, locale, token } = await params;
  if (!isLocale(locale)) notFound();

  const content = await getPreviewContent(slug, token);
  if (!content || !content.locales.includes(locale)) notFound();

  const t = createTranslator(locale);
  return (
    <>
      <p
        role="note"
        className="bg-ink text-parchment flex items-center justify-center gap-2 px-4 py-2 text-center text-sm font-medium"
      >
        <Icon icon={Eye} size={18} />
        <span>{t("wizard.preview.banner")}</span>
      </p>
      <SiteRenderer content={content} locale={locale} now={new Date()} />
    </>
  );
}
