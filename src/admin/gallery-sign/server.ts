import "server-only";
import { loadSite, type AdminIdentity } from "@/admin/site/server";
import { normalizeHttpsUrl } from "@/admin/site/normalize";
import { cardStyle, type CardStyle } from "@/admin/name-cards/style";
import { defaultLocale, locales, type Locale } from "@/i18n/config";
import { displayGalleryUrl, isOwnGallery, trackedGalleryUrl } from "@/site/gallery-url";
import { signCopy, type GallerySignVariant } from "./copy";
import type { GallerySignFormat, SignContent } from "./layout";

/** Volby cedulky z adresy (náhled) nebo formuláře (PDF); parametry česky jako u jmenovek. */
export interface GallerySignOptions {
  format: GallerySignFormat;
  variant: GallerySignVariant;
  /** Jazyk cedulky; `both` = dva jazyky webu (hlavní větší). */
  language: Locale | "both";
}

export function parseGallerySignOptions(get: (key: string) => unknown): GallerySignOptions {
  const text = (key: string) => {
    const value = get(key);
    return typeof value === "string" ? value : null;
  };
  const language = text("jazyk");
  return {
    format: text("format") === "a5" ? "a5" : "frame",
    variant: text("text") === "prohlizeni" ? "view" : "upload",
    language:
      language === "obe"
        ? "both"
        : (locales as readonly string[]).includes(language ?? "")
          ? (language as Locale)
          : "both",
  };
}

export interface GallerySignData {
  /** Adresa galerie v prostém tvaru (z pracovní kopie webu); `null` = odkaz není vyplněný. */
  url: string | null;
  /** Adresa v QR kódu (u vlastní galerie s UTM). */
  qrUrl: string | null;
  ownGallery: boolean;
  /** Odkaz je na webu jen po PINu: cedulka ho přesto nese (leží na stole na svatbě). */
  protectedLink: boolean;
  /** Blok Fotky je na webu vypnutý. */
  blockDisabled: boolean;
  /** Jazyky webu páru; volba `both` dává smysl jen při dvou. */
  siteLocales: Locale[];
  /** Skutečně použité jazyky cedulky v pořadí (hlavní první). */
  languages: Locale[];
  content: SignContent | null;
  style: CardStyle;
  couple: string;
  slug: string | null;
}

export async function loadGallerySign(
  session: AdminIdentity,
  options: GallerySignOptions,
): Promise<GallerySignData> {
  // jako editor: pracovní kopie bez bloků se doplní ze zveřejněné verze
  const site = await loadSite(session);
  const wedding = site?.doc.wedding;
  const block = site?.doc.blocks.find((b) => b.type === "gallery");
  const link = block?.type === "gallery" ? block.data.link : null;
  const url = link ? normalizeHttpsUrl(link.url) : null;
  const ownGallery = url !== null && isOwnGallery(url);
  const couple = wedding
    ? [wedding.partnerA, wedding.partnerB]
        .map((name) => name.trim())
        .filter(Boolean)
        .join(" & ")
    : "";

  const siteLocales: Locale[] = wedding
    ? [wedding.defaultLocale, ...wedding.locales.filter((l) => l !== wedding.defaultLocale)]
    : [defaultLocale];
  const languages: Locale[] =
    options.language === "both"
      ? siteLocales.slice(0, 2)
      : siteLocales.includes(options.language)
        ? [options.language]
        : [siteLocales[0]];

  const content: SignContent | null = url
    ? (() => {
        const [first, second] = languages.map((locale) =>
          signCopy(locale, options.variant, ownGallery),
        );
        return {
          couple,
          heading: first.heading,
          instruction: first.instruction,
          secondary: second ?? null,
          url: displayGalleryUrl(url),
        };
      })()
    : null;

  return {
    url,
    qrUrl: url ? trackedGalleryUrl(url, "qr-cedulka") : null,
    ownGallery,
    protectedLink: link?.protected === true,
    blockDisabled: block ? !block.enabled : true,
    siteLocales,
    languages,
    content,
    style: cardStyle(wedding?.template ?? "editorial", wedding?.palette ?? ""),
    couple,
    slug: site?.meta.slug ?? null,
  };
}
