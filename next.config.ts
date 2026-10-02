import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Původ průvodce (`app.`): formuláře s jmény na úvodní stránce se odesílají metodou GET právě sem
 * (funguje i bez JavaScriptu), proto ho `form-action` musí povolit. Hodnota je stejná jako v `src/env.ts`.
 */
const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || "https://app.se-vezmou.cz").origin;

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
  `form-action 'self' ${appOrigin}`,
  "frame-ancestors 'none'",
].join("; ");

/**
 * Rámec živého náhledu v průvodci (`/vytvorit/nahled`, česky i anglicky) smí vkládat jen vlastní
 * stránka: `frame-ancestors 'self'` a `X-Frame-Options: SAMEORIGIN` jen pro tuto cestu, všude jinde
 * zůstává zákaz vkládání. Hlavička se páruje s původní cestou požadavku (před přepisem proxy).
 */
const previewFrameCsp = csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'");

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
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Pozdější pravidlo se stejným klíčem přepíše dřívější (docs: Header Overriding Behavior).
        source: "/:lang(en)?/vytvorit/nahled",
        headers: [
          { key: "Content-Security-Policy", value: previewFrameCsp },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
  // PDF oznámení (M5) čte písma z repozitáře za běhu; do nasazení je musí přidat sledování souborů.
  outputFileTracingIncludes: {
    "/h/app/vytvorit/oznameni": ["./src/wizard/pdf/fonts/**/*"],
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
