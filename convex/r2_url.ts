import type { QueryCtx } from "./_generated/server";

type AssetLike = {
  r2Key?: string | null;
  thumbR2Key?: string | null;
  storageId?: string | null;
  thumbStorageId?: string | null;
  sourceUrl?: string | null;
};

const trimTrailingSlash = (input: string) =>
  input.endsWith("/") ? input.slice(0, -1) : input;

export const buildR2PublicUrl = (key: string) => {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) {
    return undefined;
  }
  return `${trimTrailingSlash(base)}/${key.replace(/^\/+/, "")}`;
};

// Resolves an asset's playable URL with the canonical fallback chain:
//   r2Key (public bucket via R2_PUBLIC_BASE_URL)
//   → storageId (Convex _storage)
//   → sourceUrl (external upstream)
// Returns undefined when none resolve.
export const resolveAssetUrl = async (
  ctx: { storage: QueryCtx["storage"] },
  asset: AssetLike,
): Promise<string | undefined> => {
  if (asset.r2Key) {
    const r2Url = buildR2PublicUrl(asset.r2Key);
    if (r2Url) {
      return r2Url;
    }
  }
  if (asset.storageId) {
    const url = await ctx.storage.getUrl(asset.storageId as never);
    if (url) {
      return url;
    }
  }
  return asset.sourceUrl ?? undefined;
};

// Resolves the thumbnail/card URL with the same R2-first fallback chain.
// If no dedicated thumbnail exists, callers get the primary asset URL.
export const resolveAssetThumbUrl = async (
  ctx: { storage: QueryCtx["storage"] },
  asset: AssetLike,
): Promise<string | undefined> => {
  if (asset.thumbR2Key) {
    const r2Url = buildR2PublicUrl(asset.thumbR2Key);
    if (r2Url) {
      return r2Url;
    }
  }
  if (asset.thumbStorageId) {
    const url = await ctx.storage.getUrl(asset.thumbStorageId as never);
    if (url) {
      return url;
    }
  }
  return await resolveAssetUrl(ctx, asset);
};
