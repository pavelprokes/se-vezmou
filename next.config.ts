import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {/* config options here */};

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
