import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The console is a static export served by the Fastify backend (web/admin/src/server.ts).
  // Every page is a client component that reads /api/*, so no Next.js runtime is needed in production.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // Same Tailwind v4 wiring as web/dashboard.
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

export default nextConfig;
