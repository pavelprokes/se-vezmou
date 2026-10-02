import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy. Přiměřená výchozí varianta bez nonce, aby zůstaly stránky statické:
 * skripty Next.js jsou vložené do HTML, proto `'unsafe-inline'` (přísná varianta s nonce
 * a `'strict-dynamic'` vyžaduje dynamické vykreslování všech stránek, viz docs/security-privacy.md).
 * Vše ostatní je jen z vlastní domény: písma hostuje aplikace, Vercel Analytics, Speed Insights
 * (`/_vercel/…`) i tunel Sentry (`/monitoring`) běží na stejném původu.
 */
const csp = [
  "default-src 'self'",
  // Ve vývoji React potřebuje `eval` a Vercel Analytics načítá ladicí skript.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval' https://va.vercel-scripts.com" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Bez `preload`, dokud se neověří všechny subdomény.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, {
  // Nahrávání source map se zapne, jakmile je na Vercelu nastaven SENTRY_AUTH_TOKEN.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // Obchází blokování ad-blockery.
  tunnelRoute: "/monitoring",
});
