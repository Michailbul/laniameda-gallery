import { query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { collectAssetsForFolder } from "./assets";
import {
  galleryAssetResultValidator,
  hydrateGalleryAssetResults,
} from "./galleryAssetResults";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import {
  canActorAccessOwnerUserId,
  resolveUserIdCandidates,
} from "./authz";

// How many member thumbnails the masonry stack card gets.
const STACK_PREVIEW_LIMIT = 4;
// Assets shown inside the expanded storybook modal.
const STORYBOOK_ASSET_LIMIT = 120;

const storybookPreviewValidator = v.object({
  assetId: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  contentType: v.optional(v.string()),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  thumbWidth: v.optional(v.number()),
  thumbHeight: v.optional(v.number()),
});

const storybookSummaryValidator = v.object({
  _id: v.id("folders"),
  name: v.string(),
  story: v.optional(v.string()),
  count: v.number(),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  previewAssets: v.array(storybookPreviewValidator),
});

const collectOwnerStorybookFolders = async (
  ctx: Parameters<typeof collectAssetsForFolder>[0],
  ownerUserIds: string[],
) => {
  const folders = [];
  for (const ownerCandidate of ownerUserIds) {
    const foldersForOwner = await ctx.db
      .query("folders")
      .withIndex("by_owner_normalizedName", (q) =>
        q.eq("ownerUserId", ownerCandidate).gte("normalizedName", ""),
      )
      .collect();
    folders.push(...foldersForOwner);
  }
  const seen = new Set<Id<"folders">>();
  return folders.filter((folder) => {
    if (folder.kind !== "storybook" || seen.has(folder._id)) return false;
    seen.add(folder._id);
    return true;
  });
};

export const listStorybooks = query({
  args: {
    ownerUserId: v.string(),
  },
  returns: v.array(storybookSummaryValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const storybooks = await collectOwnerStorybookFolders(ctx, ownerUserIds);

    const results = await Promise.all(
      storybooks.map(async (folder) => {
        // Membership lives in the asset's primary folderId and the
        // assetFolders join table — collectAssetsForFolder walks both.
        const members = await collectAssetsForFolder(
          ctx,
          ownerUserIds,
          folder._id,
          STORYBOOK_ASSET_LIMIT,
        );
        const previews = await Promise.all(
          members.slice(0, STACK_PREVIEW_LIMIT).map(async (asset) => {
            const [url, thumbUrl] = await Promise.all([
              resolveAssetUrl(ctx, asset),
              resolveAssetThumbUrl(ctx, asset),
            ]);
            return {
              assetId: asset._id,
              kind: asset.kind,
              contentType: asset.contentType,
              url: url ?? undefined,
              thumbUrl: thumbUrl ?? undefined,
              width: asset.width,
              height: asset.height,
              thumbWidth: asset.thumbWidth,
              thumbHeight: asset.thumbHeight,
            };
          }),
        );
        return {
          _id: folder._id,
          name: folder.name,
          story: folder.description,
          count: members.length,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          previewAssets: previews,
        };
      }),
    );

    // Newest activity first so fresh stories surface at the top of the grid.
    return results.sort(
      (left, right) =>
        (right.updatedAt ?? right.createdAt ?? 0) -
        (left.updatedAt ?? left.createdAt ?? 0),
    );
  },
});

export const getStorybook = query({
  args: {
    ownerUserId: v.string(),
    folderId: v.id("folders"),
  },
  returns: v.union(
    v.null(),
    v.object({
      folder: v.object({
        _id: v.id("folders"),
        name: v.string(),
        story: v.optional(v.string()),
        createdAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
      }),
      assets: v.array(galleryAssetResultValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.kind !== "storybook") {
      return null;
    }
    if (!canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
      throw new ConvexError("Storybook does not belong to this user.");
    }

    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const members = await collectAssetsForFolder(
      ctx,
      ownerUserIds,
      folder._id,
      STORYBOOK_ASSET_LIMIT,
    );
    const assets = await hydrateGalleryAssetResults(ctx, members);

    return {
      folder: {
        _id: folder._id,
        name: folder.name,
        story: folder.description,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      },
      assets,
    };
  },
});
