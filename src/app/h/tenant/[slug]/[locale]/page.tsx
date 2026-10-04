import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SITE_NAMESPACES } from "@/components/site/context";
import { SiteRenderer } from "@/components/site/site-renderer";
import { isLocale, type Locale } from "@/i18n/config";
import { localizedPath } from "@/i18n/pathnames";
import { getTranslator } from "@/i18n/load";
import { getPublicContent } from "@/site/content";
import { loadGuestContext } from "@/site/guest-context";
import { eventsForGuest } from "@/site/invite";
import { languageAlternates, originFromHeaders } from "@/site/origin";

type Props = PageProps<"/h/tenant/[slug]/[locale]">;

async function load(slug: string, locale: string) {
  if (!isLocale(locale)) return null;
  // Neexistující, nezveřejněná i zablokovaná adresa: `null`, tedy stejná 404 (FR-PRIV-3).
  const content = await getPublicContent(slug);
  // Jazyk, který web nenabízí, je stejná 404 jako neexistující web.
  if (!content || !content.locales.includes(locale)) return null;
  return { content, locale };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, locale } = await params;
  const loaded = await load(slug, locale);
  if (!loaded) return {};
  const { content } = loaded;
  const h = await headers();
  const origin = originFromHeaders(h.get("host"), h.get("x-forwarded-proto"));
  const languages = languageAlternates(origin, content.locales, content.defaultLocale);
  const t = await getTranslator(loaded.locale, ["site"]);
  return {
    title: t("site.title", { a: content.partners.a, b: content.partners.b }),
    // `hreflang` bez indexace: web zůstává `noindex` (hlavička z proxy i meta robots).
    alternates: { canonical: languages[loaded.locale], languages },
    robots: { index: false, follow: false },
  };
}

/**
 * Web páru ze zveřejněného snímku v databázi (`getPublicContent(slug)`). Čte aktuální čas
 * (odpočet) a živou fázi, proto se vykresluje za běhu.
 *
 * Nad snímkem se za běhu načítá živý stav hosta (`loadGuestContext`, M8): fáze RSVP spočítaná
 * databází teď, stav formuláře RSVP z cookie lístku a citlivé bloky jen pro hosta s relací po PINu.
 * Bez PINu se citlivý obsah nenačítá vůbec, takže se nedostane do HTML ani do RSC payloadu.
 */
export default async function TenantSite({ params }: Props) {
  await connection();
  const { slug, locale } = await params;
  const loaded = await load(slug, locale);
  if (!loaded) notFound();

  // Přepínač nabízí jen jazyky, které web páru opravdu má (bez automatického přesměrování).
  const localeHrefs = Object.fromEntries(
    loaded.content.locales.map((l: Locale) => [l, localizedPath("home", l)]),
  );
  const guest = await loadGuestContext(slug, loaded.locale);
  const t = await getTranslator(loaded.locale, SITE_NAMESPACES);
  return (
    <SiteRenderer
      content={
        guest
          ? {
              ...loaded.content,
              phase: guest.phase,
              events: eventsForGuest(loaded.content.events, guest.invitedEventIds),
            }
          : loaded.content
      }
      t={t}
      localeHrefs={localeHrefs}
      now={new Date()}
      rsvp={guest?.rsvp ?? null}
      sensitiveUnlocked={guest?.sensitiveUnlocked ?? false}
      sensitive={guest?.sensitive ?? null}
    />
  );
}
