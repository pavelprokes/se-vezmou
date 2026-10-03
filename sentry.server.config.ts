import * as Sentry from "@sentry/nextjs";
import { sentryPrivacyOptions } from "@/lib/sentry-scrub";

// Server obsluhuje i weby párů, proto se každá událost před odesláním čistí (adresa, query, tělo požadavku,
// cookies, drobečková navigace; `/nahled/<token>` nikdy neopustí aplikaci), viz `src/lib/sentry-scrub.ts`.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production" && !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  ...sentryPrivacyOptions,
});
