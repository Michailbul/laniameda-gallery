import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // __dirname is undefined in ESM contexts on Vercel; use cwd for tracing root.
  outputFileTracingRoot: path.join(process.cwd()),
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
