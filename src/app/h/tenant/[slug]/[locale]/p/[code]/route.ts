import { NextResponse, type NextRequest } from "next/server";
import { GUEST_SESSION, RATE_RULES } from "@/auth/config";
import { generateToken, hashToken } from "@/auth/crypto";
import { setGuestCookie } from "@/auth/guest-session";
import { isLocale, defaultLocale } from "@/i18n/config";
import { rateKey } from "@/auth/rate-limit";
import { getClientIp } from "@/auth/request";
import { requireEnv } from "@/env";
import { authCreateSession, rateLimitHit, resolveSlug } from "@/lib/db/rpc";
import { fetchInviteInfo } from "@/lib/rsvp/db";
import { getSiteState } from "@/site/content";
import { inviteTarget } from "@/site/invite";
import { originFromHeaders } from "@/site/origin";
import { clearInvite, INVITE_PATTERN, setInvite } from "@/site/tenant-request";

/**
 * Osobní odkaz domácnosti (`/p/<kód>`, QR na pozvánce): platný kód se uloží do cookie a host jde na web
 * v svém jazyce rovnou k RSVP; formulář se otevře pro jeho domácnost a program ukáže jen jeho události.
 * Na zamčeném webu (heslo na celý web) odkaz navíc vydá relaci hosta, jako by zadal PIN z pozvánky.
 * Svatba je z hostitele (proxy ji dává do cesty, přímý požadavek na `/h/...` končí 404). Neplatný kód
 * jen přesměruje na úvod, smaže cookie s kódem (stránka zamčeného webu by jinak přesměrovávala znovu)
 * a nic neprozradí. Kód má 80 bitů, hádání nemá smysl omezovat.
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

  const state = await getSiteState(slug);
  if (!state) return new NextResponse(null, { status: 404 });
  const site = state.kind === "published" ? state.content : { ...state.gate, blocks: [] };
  const resolved = INVITE_PATTERN.test(code) ? await resolveSlug(slug) : null;
  const info = resolved ? await fetchInviteInfo(resolved.weddingId, code) : null;
  if (!info) {
    await clearInvite();
    return NextResponse.redirect(new URL(inviteTarget(site, null, urlLocale), origin), 303);
  }
  await setInvite(code);
  const target = new URL(inviteTarget(site, info.locale, urlLocale), origin);
  if (state.kind === "locked" && !(await sessionAllowed(slug))) {
    // bez relace zůstane brána s PINem; příznak zabrání stránce poslat hosta s kódem zpět sem (smyčka)
    target.searchParams.set("brana", "1");
    return NextResponse.redirect(target, 303);
  }
  if (state.kind === "locked") {
    const token = generateToken();
    await authCreateSession({
      kind: "guest_pin",
      weddingId: state.weddingId,
      subjectId: null,
      tokenHash: hashToken(token),
      idleSeconds: GUEST_SESSION.idleSeconds,
      absoluteSeconds: GUEST_SESSION.absoluteSeconds,
    });
    await setGuestCookie(token);
  }
  return NextResponse.redirect(target, 303);
}

/**
 * Strop relací hosta z osobního odkazu podle webu a IP (náhledy odkazů v aplikacích, skripty). Selhání čítače
 * relaci nevydá (zavřeně, jako u PINu): host uvidí bránu a může zadat PIN.
 */
async function sessionAllowed(slug: string): Promise<boolean> {
  try {
    const hit = await rateLimitHit(
      rateKey(requireEnv("RATE_LIMIT_SECRET"), "invite-session", `${slug}\0${await getClientIp()}`),
      RATE_RULES.inviteSessionIp.limit,
      RATE_RULES.inviteSessionIp.windowSeconds,
    );
    return hit.allowed;
  } catch {
    return false;
  }
}
