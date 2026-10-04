import { isLocale } from "@/i18n/config";
import { getTranslator } from "@/i18n/load";
import { ogCard } from "@/seo/og-card";
import { getVisitorSiteState } from "@/site/content";
import { originFromHeaders } from "@/site/origin";
import { formatDateRange } from "@/site/format";
import { pick } from "@/site/i18n-text";
import { getPalette } from "@/site/themes/palettes";

/**
 * Obrázek pro sdílení webu páru (`/og`, `/en/og`): jména, datum a místo v barvách šablony. Zamčený web
 * (heslo na celý web) ukáže jen jména, stejně jako jeho brána, i když obrázek otevře host po PINu
 * (čte se jako anonymní návštěvník, odpověď je ve sdílené mezipaměti). Neexistující web je 404.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/h/tenant/[slug]/[locale]/og">,
) {
  const { slug, locale } = await params;
  if (!isLocale(locale)) return new Response(null, { status: 404 });
  // vždy jako anonymní návštěvník: odpověď se ukládá do sdílené mezipaměti (relace hosta ji nesmí ovlivnit)
  const state = await getVisitorSiteState(slug);
  if (!state) return new Response(null, { status: 404 });
  const look = state.kind === "published" ? state.content : state.gate;
  // jazyk, který web nenabízí, je stejná 404 jako u stránky (FR-PRIV-3)
  if (!look.locales.includes(locale)) return new Response(null, { status: 404 });

  const t = await getTranslator(locale, ["site"]);
  const { colors } = getPalette(look.template, look.palette);
  const host = new URL(
    originFromHeaders(request.headers.get("host"), request.headers.get("x-forwarded-proto")),
  ).hostname;

  let subtitle = "";
  if (state.kind === "published") {
    const { content } = state;
    const venue = content.venues[0];
    const place = venue ? pick(venue.name, locale, content.defaultLocale) : "";
    subtitle = [formatDateRange(content.startsOn, content.endsOn, locale), place]
      .filter(Boolean)
      .join(" · ");
  }

  return ogCard({
    eyebrow: t("site.hero.saveTheDate"),
    title: t("site.title", { a: look.partners.a, b: look.partners.b }),
    subtitle,
    footer: host,
    colors: {
      bg: colors.bg,
      text: colors.text,
      accent: colors.accent,
      muted: colors.muted,
      rule: colors.ornament,
    },
    serif: look.template !== "modern",
  });
}
