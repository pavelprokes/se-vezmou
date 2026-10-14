import { NextResponse, type NextRequest } from "next/server";
import { RATE_RULES } from "@/auth/config";
import { rateKey } from "@/auth/rate-limit";
import { assertSameOrigin, getClientIp } from "@/auth/request";
import { requireEnv } from "@/env";
import { isLocale, defaultLocale, localePath } from "@/i18n/config";
import { rateLimitHit, resolveSlug, serviceRpc } from "@/lib/db/rpc";
import { originFromHeaders } from "@/site/origin";

const TOKEN = /^[0-9a-f]{36}$/;

/**
 * Odhlášení upozornění na změny (tlačítko na stránce `/upozorneni`). Token z e-mailu smaže jediný záznam
 * v `rsvp_updates`; neplatný či použitý token dá stejnou odpověď „neplatný odkaz“. Kontrola původu (CSRF)
 * a strop pokusů podle webu a IP; výsledek je přesměrování zpět na stránku (POST → 303 → GET).
 */
export async function POST(
  request: NextRequest,
  { params }: RouteContext<"/h/tenant/[slug]/[locale]/upozorneni/odhlasit">,
) {
  const { slug, locale } = await params;
  const urlLocale = isLocale(locale) ? locale : defaultLocale;
  try {
    await assertSameOrigin();
  } catch {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await resolveSlug(slug))) return new NextResponse(null, { status: 404 });

  const origin = originFromHeaders(
    request.headers.get("host"),
    request.headers.get("x-forwarded-proto"),
  );
  const target = new URL(localePath("/upozorneni", urlLocale), origin);

  const hit = await rateLimitHit(
    rateKey(
      requireEnv("RATE_LIMIT_SECRET"),
      "guest-updates-unsubscribe",
      `${slug}\0${await getClientIp()}`,
    ),
    RATE_RULES.guestUpdatesUnsubscribeIp.limit,
    RATE_RULES.guestUpdatesUnsubscribeIp.windowSeconds,
  );
  if (!hit.allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: { "Retry-After": String(hit.retryAfter) },
    });
  }

  const form = await request.formData().catch(() => null);
  const token = form?.get("t");
  const ok =
    typeof token === "string" && TOKEN.test(token)
      ? await serviceRpc<boolean>("rsvp_updates_unsubscribe", { p_token: token })
      : false;
  target.searchParams.set(ok ? "hotovo" : "chyba", "1");
  return NextResponse.redirect(target, 303);
}
