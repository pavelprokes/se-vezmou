import "server-only";
import { currentHostConfig, siteHostname } from "@/auth/app-origin";
import { env, requireEnv } from "@/env";
import type { Locale } from "@/i18n/config";
import { ADMIN_PATHS } from "@/admin/paths";
import { sendTemplatedEmail } from "@/lib/email/send";
import { renderDeletionNotice, renderRetentionNotice } from "@/lib/email/templates";
import type { RenderedEmail } from "@/lib/email/templates";
import type { EmailLogType } from "@/lib/db/rpc";
import type { ClaimedNotice, Recipient } from "./rpc";

/**
 * Odeslání upozornění a zpráv o smazání správcům (FR-LC-2, FR-MAIL-1). Zpráva nese jen datum, adresu webu
 * a odkaz na přihlášení. `email_log` eviduje jen typ, jazyk, HMAC adresy a její doménu; adresy se nelogují.
 */

export type NoticeContext = {
  /** Odeslání jedné zprávy; vrací `true`, když ji doprava přijala. */
  send: (input: {
    type: EmailLogType;
    to: string;
    weddingId: string | null;
    locale: Locale;
    email: RenderedEmail;
  }) => Promise<boolean>;
  /** Adresa přihlášení do správy (`https://app.se-vezmou.cz/prihlaseni`). */
  loginUrl: string;
  /** Stránka exportu ve správě (`https://app.se-vezmou.cz/data`), cíl upozornění před smazáním. */
  exportUrl: string;
  /** Adresa webu pro popis v e-mailu, nebo `undefined`, když web adresu nemá. */
  siteOf: (slug: string | null) => string | undefined;
};

/** Kontext z prostředí (AUTH_SECRET pro HMAC adres v `email_log`, NEXT_PUBLIC_APP_URL pro odkaz). */
export function createNoticeContext(): NoticeContext {
  const secret = requireEnv("AUTH_SECRET");
  const config = currentHostConfig();
  return {
    send: (input) => sendTemplatedEmail({ ...input, secret, requireDelivery: true }),
    loginUrl: `${new URL(env.NEXT_PUBLIC_APP_URL).origin}/prihlaseni`,
    exportUrl: `${new URL(env.NEXT_PUBLIC_APP_URL).origin}${ADMIN_PATHS.data}`,
    siteOf: (slug) => (slug ? siteHostname(slug, config) : undefined),
  };
}

export type NoticeDelivery = { sent: number; failed: number };

/** Sestaví zprávu pro převzaté upozornění; `now` je čas „smazání“ u zprávy fáze done. */
export function renderNotice(
  notice: ClaimedNotice,
  locale: Locale,
  context: Pick<NoticeContext, "loginUrl" | "exportUrl" | "siteOf">,
  now: Date,
): { type: EmailLogType; email: RenderedEmail } {
  const site = context.siteOf(notice.slug);
  if (notice.stage === "done") {
    return {
      type: "deletion_notice",
      email: renderDeletionNotice({
        locale,
        kind: notice.kind === "health_purge" ? "health_purge" : "guest_purge",
        at: now,
        timeZone: notice.timezone,
        site,
        loginUrl: context.loginUrl,
      }),
    };
  }
  return {
    type: "expiry_notice",
    email: renderRetentionNotice({
      locale,
      kind: notice.kind,
      stage: notice.stage,
      eventAt: new Date(notice.event_at),
      timeZone: notice.timezone,
      site,
      exportUrl: context.exportUrl,
    }),
  };
}

/** Pošle upozornění všem adresátům. Nikdy nevyhazuje: selhání jednoho adresáta se jen započítá. */
export async function deliverNotice(
  notice: ClaimedNotice,
  recipients: readonly Recipient[],
  context: NoticeContext,
  now: Date,
): Promise<NoticeDelivery> {
  const delivery: NoticeDelivery = { sent: 0, failed: 0 };
  for (const recipient of recipients) {
    const { type, email } = renderNotice(notice, recipient.locale, context, now);
    let ok = false;
    try {
      ok = await context.send({
        type,
        to: recipient.email,
        weddingId: notice.wedding_id,
        locale: recipient.locale,
        email,
      });
    } catch {
      ok = false;
    }
    if (ok) delivery.sent += 1;
    else delivery.failed += 1;
  }
  return delivery;
}
