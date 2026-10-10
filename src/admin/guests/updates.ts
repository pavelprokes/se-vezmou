import "server-only";
import { z } from "zod";
import { currentHostConfig } from "@/auth/app-origin";
import { RATE_RULES } from "@/auth/config";
import { getHost } from "@/auth/request";
import { requireEnv } from "@/env";
import { localePath, type Locale } from "@/i18n/config";
import { authSessionContext } from "@/lib/db/rpc";
import { sendTemplatedEmail } from "@/lib/email/send";
import { renderGuestUpdate } from "@/lib/email/templates";
import { limited } from "@/lib/rate-guard";
import { listUpdateSubscribers, updateRecipients } from "@/lib/rsvp/admin";
import { siteUrl, tenantOrigin } from "@/wizard/urls";
import type { AdminIdentity } from "@/admin/site/server";

/**
 * Upozornění hostům na změnu (docs/plan-funkci-2026-10.md, fáze 1). Pár napíše text (v jazycích webu),
 * e-mail dostane každý host, který v odpovědi sám zaškrtl souhlas. Host bez textu ve svém jazyce
 * dostane text v jiném vyplněném jazyce. Odeslání je omezené počtem za den; databáze ho zapíše do
 * auditu (počet, ne adresy). Adresy se neukládají nikam jinam a do záznamu e-mailů jde jen HMAC.
 */

export const MAX_UPDATE_TEXT = 1000;

export const guestUpdateInputSchema = z
  .object({ cs: z.string().optional(), en: z.string().optional() })
  .strict();

export type GuestUpdateResult =
  | { status: "sent"; count: number }
  | { status: "empty" }
  | { status: "too_long" }
  | { status: "nobody" }
  | { status: "limited"; retryAfter: number }
  | { status: "failed" };

/** Odhlašovací stránka na webu svatby (`/upozorneni`, ostatní jazyky pod předponou). */
export const UNSUBSCRIBE_PATH = "/upozorneni";

const SEND_CONCURRENCY = 5;

export async function sendGuestUpdates(
  session: AdminIdentity,
  input: unknown,
): Promise<GuestUpdateResult> {
  const parsed = guestUpdateInputSchema.safeParse(input);
  if (!parsed.success) return { status: "empty" };
  const texts: Partial<Record<Locale, string>> = {};
  for (const locale of ["cs", "en"] as const) {
    const value = parsed.data[locale]?.trim() ?? "";
    if (value.length > MAX_UPDATE_TEXT) return { status: "too_long" };
    if (value !== "") texts[locale] = value;
  }
  const fallback = texts.cs ?? texts.en;
  if (!fallback) return { status: "empty" };

  // Bez přihlášených hostů se limit nespotřebuje.
  if ((await listUpdateSubscribers(session)).length === 0) return { status: "nobody" };
  const retryAfter = await limited(
    "guest-updates",
    session.weddingId,
    RATE_RULES.guestUpdatesWedding,
  );
  if (retryAfter !== null) return { status: "limited", retryAfter };

  const context = await authSessionContext(session.weddingId);
  if (!context?.slug) return { status: "failed" };
  const slug = context.slug;
  const recipients = await updateRecipients(session);
  if (recipients.length === 0) return { status: "nobody" };

  const host = await getHost();
  const root = currentHostConfig().rootDomains[0];
  const origin = tenantOrigin(slug, host, root);
  const secret = requireEnv("AUTH_SECRET");

  let sent = 0;
  const queue = [...recipients];
  async function worker() {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const email = renderGuestUpdate({
        locale: next.locale,
        partners: { a: context!.partnerAName, b: context!.partnerBName },
        text: texts[next.locale] ?? fallback!,
        siteUrl: siteUrl(slug, host, next.locale, root),
        unsubscribeUrl: `${origin}${localePath(UNSUBSCRIBE_PATH, next.locale)}?t=${next.unsubscribeToken}`,
      });
      const ok = await sendTemplatedEmail({
        type: "guest_update",
        to: next.email,
        weddingId: session.weddingId,
        locale: next.locale,
        email,
        secret,
      });
      if (ok) sent += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, queue.length) }, worker));
  return sent === 0 ? { status: "failed" } : { status: "sent", count: sent };
}
