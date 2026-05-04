import type { QueryCtx } from "./_generated/server";

type AssetLike = {
  r2Key?: string | null;
  storageId?: string | null;
  sourceUrl?: string | null;
};

const trimTrailingSlash = (input: string) =>
  input.endsWith("/") ? input.slice(0, -1) : input;

const buildR2PublicUrl = (key: string) => {
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
