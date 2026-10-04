import { NextResponse, type NextRequest } from "next/server";
import { isLocale, defaultLocale } from "@/i18n/config";
import { resolveSlug } from "@/lib/db/rpc";
import { fetchInviteInfo } from "@/lib/rsvp/db";
import { getPublicContent } from "@/site/content";
import { inviteTarget } from "@/site/invite";
import { originFromHeaders } from "@/site/origin";
import { INVITE_PATTERN, setInvite } from "@/site/tenant-request";

/**
 * Osobní odkaz domácnosti (`/p/<kód>`, QR na pozvánce): platný kód se uloží do cookie a host jde na web
 * v svém jazyce rovnou k RSVP; formulář se otevře pro jeho domácnost a program ukáže jen jeho události.
 * Svatba je z hostitele (proxy ji dává do cesty, přímý požadavek na `/h/...` končí 404). Neplatný kód
 * jen přesměruje na úvod, nic nenastaví a nic neprozradí. Kód má ~76 bitů, hádání nemá smysl omezovat.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/h/tenant/[slug]/[locale]/p/[code]">,
) {
  const { slug, locale, code } = await params;
  const urlLocale = isLocale(locale) ? locale : defaultLocale;
  const origin = originFromHeaders(
    request.headers.get("host"),
    request.headers.get("x-forwarded-proto"),
  );

  const content = await getPublicContent(slug);
  if (!content) return new NextResponse(null, { status: 404 });

  const resolved = INVITE_PATTERN.test(code) ? await resolveSlug(slug) : null;
  const info = resolved ? await fetchInviteInfo(resolved.weddingId, code) : null;
  if (!info) {
    return NextResponse.redirect(new URL(inviteTarget(content, null, urlLocale), origin), 303);
  }
  await setInvite(code);
  return NextResponse.redirect(new URL(inviteTarget(content, info.locale, urlLocale), origin), 303);
}
