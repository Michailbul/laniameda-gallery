import type { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

// Types flow straight from the authless showcase queries so the frontend and
// backend contracts never drift.
export type ShowcaseHomeData = FunctionReturnType<
  typeof api.showcase.getShowcaseHome
>;

export type ShowcaseAsset = ShowcaseHomeData["inspiration"][number];

export type ShowcaseSetSummary = ShowcaseHomeData["collections"][number];

export type ShowcaseSet = NonNullable<
  FunctionReturnType<typeof api.showcase.getShowcaseCollection>
>;

// The best available media URL for a full-bleed view (falls back to thumb).
export const assetSrc = (asset: {
  url?: string;
  thumbUrl?: string;
}): string | undefined => asset.url ?? asset.thumbUrl;

// The best available URL for a grid tile (thumb first to keep the grid light).
export const assetThumb = (asset: {
  url?: string;
  thumbUrl?: string;
}): string | undefined => asset.thumbUrl ?? asset.url;

// Re-exported from the shared rule so the showcase and the vault agree on what
// counts as a real prompt.
export { meaningfulPrompt } from "@/lib/prompt";

// Aspect ratio for masonry tiles; defaults to a portrait-ish frame when the
// source never recorded dimensions.
export const assetRatio = (asset: {
  width?: number;
  height?: number;
}): number => {
  if (asset.width && asset.height && asset.height > 0) {
    return asset.width / asset.height;
  }
  return 0.8;
};
