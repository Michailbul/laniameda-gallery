import { ConvexHttpClient } from "convex/browser";

const resolveConvexUrl = () => {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("CONVEX_URL is not configured.");
  }
  return url;
};

export const getServerConvexClient = () => {
  return new ConvexHttpClient(resolveConvexUrl());
};

