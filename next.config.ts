import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // __dirname is undefined in ESM contexts on Vercel; use cwd for tracing root.
  outputFileTracingRoot: path.join(process.cwd()),
  outputFileTracingIncludes: {
    "/api/skills/laniameda-gallery": ["./content/skills/**/*"],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      const existingIgnored = config.watchOptions?.ignored;
      const ignored = Array.isArray(existingIgnored)
        ? existingIgnored
        : existingIgnored
          ? [existingIgnored]
          : [];
      const ignoredGlobs = ignored.filter(
        (pattern): pattern is string =>
          typeof pattern === "string" && pattern.length > 0,
      );

      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          ...ignoredGlobs,
          "**/.claude/**",
          "**/.superdesign/**",
        ],
      };
    }

    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "*.convex.cloud",
      },
    ],
  },
};

export default nextConfig;
