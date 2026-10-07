import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/w/liz", destination: "/w/dear-annete", permanent: true }];
  },
  // __dirname is undefined in ESM contexts on Vercel; use cwd for tracing root.
  outputFileTracingRoot: path.join(process.cwd()),
  // Serve canonical skill sources from the deployment, including on Vercel.
  outputFileTracingIncludes: {
    "/llms.txt": ["./skills/laniameda-gallery/SKILL.md"],
    "/skills/laniameda-gallery/\\[\\.\\.\\.resource\\]": [
      "./skills/laniameda-gallery/SKILL.md",
      "./skills/laniameda-gallery/references/*.md",
      "./skills/laniameda-gallery/scripts/gallery.mjs",
      "./skills/laniameda-gallery/scripts/gallery-client.mjs",
    ],
    "/api/agent/instructions": ["./skills/laniameda-gallery/**"],
    "/api/mcp": ["./skills/laniameda-gallery/**"],
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
