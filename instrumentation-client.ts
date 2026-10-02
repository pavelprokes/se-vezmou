import * as Sentry from "@sentry/nextjs";
import { isSentryBrowserHost, sentryPrivacyOptions } from "@/lib/sentry-scrub";

/**
 * Sentry v prohlížeči (docs/adr/0007-analytics.md, docs/security-privacy.md kap. 3 a 5.5): běží jen na hostiteli
 * úvodní stránky. Weby párů (hosté), průvodce a administrace skript třetí strany nenačítají a nic neodesílají;
 * adresy tam nesou slug a tajný odkaz náhledu (`/nahled/<token>`). Chyby těchto hostitelů se zachycují jen na serveru.
 * Události se navíc čistí (adresa, query, tělo, cookies, drobečková navigace), viz `src/lib/sentry-scrub.ts`.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://se-vezmou.cz";
const onMarketingHost =
  typeof window !== "undefined" && isSentryBrowserHost(window.location.hostname, siteUrl);

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled:
    process.env.NODE_ENV === "production" &&
    !!process.env.NEXT_PUBLIC_SENTRY_DSN &&
    onMarketingHost,
  tracesSampleRate: 0.1,
  ...sentryPrivacyOptions,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
