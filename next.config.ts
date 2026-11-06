import type { NextConfig } from "next";
import path from "node:path";

// The director review (app/review) is also served from another domain
// (www.mishabuloichyk.com/cassandra) through that site's rewrites. A relative
// asset prefix lets that site forward /gallery-assets/* here, so the page's
// scripts and fonts load on either domain. Production builds only.
const ASSET_PREFIX = "/gallery-assets";
const useAssetPrefix = process.env.NODE_ENV === "production" && process.env.GALLERY_ASSET_PREFIX !== "off";

const nextConfig: NextConfig = {
  ...(useAssetPrefix ? { assetPrefix: ASSET_PREFIX } : {}),
  async rewrites() {
    return {
      // Serve prefixed asset requests from the normal /_next path.
      beforeFiles: useAssetPrefix
        ? [{ source: `${ASSET_PREFIX}/_next/:path+`, destination: "/_next/:path+" }]
        : [],
      afterFiles: [],
      fallback: [],
    };
  },
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
