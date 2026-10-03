import type { Metadata } from "next";
import { locales, type Locale } from "@/i18n/config";
import { hreflangAlternates, type PageRef } from "@/i18n/pathnames";

/** Obrázek pro sdílení (1200 × 630). Statické soubory ve `public/og`, zvlášť pro každý jazyk. */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

export function ogImagePath(locale: Locale): string {
  return `/og/se-vezmou-${locale}.png`;
}

/** Jazykové označení pro `og:locale` (`cs_CZ`, `en_GB`). */
const ogLocale: Record<Locale, string> = { cs: "cs_CZ", en: "en_GB" };

export interface PageMetadataInput {
  /** Stránka z tabulky cest, nebo rovnou adresy všech jazykových verzí (článek blogu). */
  route: PageRef;
  locale: Locale;
  siteUrl: string;
  title: string;
  description: string;
  siteName: string;
  imageAlt: string;
  /** Zástupné stránky: nechat mimo vyhledávače, odkazy ale sledovat. */
  noindex?: boolean;
  /** Článek: Open Graph typu `article` s daty vydání a úpravy (`YYYY-MM-DD`). */
  article?: { publishedTime: string; modifiedTime: string };
}

/**
 * Metadata stránky úvodního webu: `title`, `description`, `canonical` na sebe, `hreflang`
 * (cs, en, x-default), Open Graph a Twitter karta. Jediné místo, takže se stránky nerozejdou.
 */
export function pageMetadata(input: PageMetadataInput): Metadata {
  const { route, locale, siteUrl, title, description, siteName, imageAlt, noindex, article } =
    input;
  const links = hreflangAlternates(route, locale, siteUrl);
  const url = links.canonical;
  const image = {
    url: ogImagePath(locale),
    ...OG_IMAGE_SIZE,
    alt: imageAlt,
  };
  return {
    title,
    description,
    alternates: links,
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      ...(article ? { type: "article", ...article } : { type: "website" }),
      url,
      siteName,
      title,
      description,
      locale: ogLocale[locale],
      alternateLocale: locales.filter((l) => l !== locale).map((l) => ogLocale[l]),
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: image.url, alt: imageAlt }],
    },
  };
}
