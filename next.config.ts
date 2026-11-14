import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: {
    // This non-secret deployment label is safe to expose to the browser bundle.
    NEXT_PUBLIC_SENTRY_ENVIRONMENT:
      process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development"
  }
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Keep runtime error capture enabled, but temporarily disable all build-time
  // source-map generation, Debug ID injection, upload, and deletion while the
  // upstream Turbopack alignment fix is awaiting a released SDK/CLI version.
  sourcemaps: {
    disable: true
  },
  silent: !process.env.CI,
  telemetry: false
});
