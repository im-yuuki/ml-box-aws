import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Sandboxes are managed per Project; the old user-level pages are retired.
  async redirects() {
    return [
      { source: "/sandboxes", destination: "/projects", permanent: false },
      { source: "/sandboxes/:path*", destination: "/projects", permanent: false },
    ];
  },
  // Cookie-based locale selection is request-time data. Keep the dashboard on
  // the standard dynamic rendering model instead of Cache Components/PPR.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  allowedDevOrigins: ["localhost", "127.0.0.1", "::1"],
};

export default withNextIntl(nextConfig);
