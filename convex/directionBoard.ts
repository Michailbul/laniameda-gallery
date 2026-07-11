import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { APPROVED_TAG_NAME, collectAssetsForFolder } from "./assets";
import {
  collectProjectCollectionIds,
  collectProjectCollectionLinks,
} from "./projects";
import { normalizeTagName } from "./helpers";
import { optionalProjectSectionValidator } from "./validators";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import {
  canActorAccessOwnerUserId,
  resolveUserIdCandidates,
} from "./authz";

// Per-member-collection asset cap on the public board (mirrors getProject).
const BOARD_COLLECTION_ASSET_LIMIT = 200;

/**
 * Public payload for one asset on a shared direction board. Deliberately
 * trimmed: no prompt text, model names, tags, or owner ids leak to viewers —
 * a colleague needs the media, its dimensions, a label, and the approved flag.
 */
const boardAssetValidator = v.object({
  id: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  contentType: v.optional(v.string()),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  fileName: v.optional(v.string()),
  title: v.optional(v.string()),
  approved: v.boolean(),
  createdAt: v.number(),
});

const boardValidator = v.object({
  name: v.string(),
  brief: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
  collections: v.array(
    v.object({
      id: v.id("folders"),
      name: v.string(),
      section: optionalProjectSectionValidator,
      coverAssetId: v.optional(v.id("assets")),
      beatCharacterFolderId: v.optional(v.id("folders")),
      beatLocationFolderId: v.optional(v.id("folders")),
      count: v.number(),
      assets: v.array(boardAssetValidator),
    }),
  ),
});

const generateShareToken = () => {
  // 144 bits of entropy, hex-encoded → 36 chars. Unguessable link capability.
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

const requireOwnedProject = async (
  ctx: QueryCtx | MutationCtx,
  ownerUserId: string,
  projectId: Id<"folders">,
): Promise<Doc<"folders">> => {
  const trimmed = ownerUserId.trim();
  if (!trimmed) {
    throw new ConvexError("ownerUserId is required.");
  }
  const folder = await ctx.db.get(projectId);
  if (!folder || folder.kind !== "project") {
    throw new ConvexError("Project not found.");
  }
  if (!canActorAccessOwnerUserId(trimmed, folder.ownerUserId)) {
    throw new ConvexError("Project does not belong to this user.");
  }
  return folder;
};

export const getShareState = query({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
  },
  returns: v.object({
    enabled: v.boolean(),
    token: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const folder = await requireOwnedProject(
      ctx,
      args.ownerUserId,
      args.projectId,
    );
    return { enabled: Boolean(folder.shareToken), token: folder.shareToken };
  },
});

export const enableShare = mutation({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
  },
  returns: v.object({ token: v.string() }),
  handler: async (ctx, args) => {
    const folder = await requireOwnedProject(
      ctx,
      args.ownerUserId,
      args.projectId,
    );
    if (folder.shareToken) {
      return { token: folder.shareToken };
    }
    const token = generateShareToken();
    await ctx.db.patch(folder._id, { shareToken: token, updatedAt: Date.now() });
    return { token };
  },
});

export const disableShare = mutation({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
  },
  returns: v.object({ disabled: v.boolean() }),
  handler: async (ctx, args) => {
    const folder = await requireOwnedProject(
      ctx,
      args.ownerUserId,
      args.projectId,
    );
    if (!folder.shareToken) {
      return { disabled: false };
    }
    await ctx.db.patch(folder._id, {
      shareToken: undefined,
      updatedAt: Date.now(),
    });
    return { disabled: true };
  },
});

/**
 * PUBLIC: resolve one asset of a shared board for the download proxy route.
 * Validates that the asset actually belongs to one of the shared project's
 * member collections before handing out its URL. R2's public domain has no
 * CORS headers, so the board downloads via /api/board/download instead of a
 * cross-origin fetch.
 */
export const getBoardAssetDownload = query({
  args: {
    token: v.string(),
    assetId: v.id("assets"),
  },
  returns: v.union(
    v.null(),
    v.object({
      url: v.string(),
      fileName: v.optional(v.string()),
      contentType: v.optional(v.string()),
      kind: v.union(v.literal("image"), v.literal("video")),
    }),
  ),
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!token) return null;

    const folder = await ctx.db
      .query("folders")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", token))
      .unique();
    if (!folder || folder.kind !== "project" || !folder.ownerUserId) {
      return null;
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) return null;

    const ownerUserIds = resolveUserIdCandidates(folder.ownerUserId);
    if (!asset.ownerUserId || !ownerUserIds.includes(asset.ownerUserId)) {
      return null;
    }

    const collectionIds = new Set<string>(
      await collectProjectCollectionIds(ctx, ownerUserIds, folder._id),
    );
    let isMember = Boolean(asset.folderId && collectionIds.has(asset.folderId));
    if (!isMember) {
      const links = await ctx.db
        .query("assetFolders")
        .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
        .collect();
      isMember = links.some((link) => collectionIds.has(link.folderId));
    }
    if (!isMember) return null;

    const url = await resolveAssetUrl(ctx, asset);
    if (!url) return null;

    return {
      url,
      fileName: asset.fileName,
      contentType: asset.contentType,
      kind: asset.kind,
    };
  },
});

// One direction (member collection) of a project, in the trimmed public
// asset shape — the payload behind the packaged-PDF export.
const directionPayloadValidator = v.union(
  v.null(),
  v.object({
    projectName: v.string(),
    direction: v.object({
      id: v.id("folders"),
      name: v.string(),
      coverAssetId: v.optional(v.id("assets")),
      assets: v.array(boardAssetValidator),
    }),
  }),
);

const resolveDirectionPayload = async (
  ctx: QueryCtx,
  projectFolder: Doc<"folders">,
  folderId: Id<"folders">,
) => {
  if (!projectFolder.ownerUserId) return null;
  const ownerUserIds = resolveUserIdCandidates(projectFolder.ownerUserId);
  const collectionIds = await collectProjectCollectionIds(
    ctx,
    ownerUserIds,
    projectFolder._id,
  );
  if (!collectionIds.includes(folderId)) return null;

  const collectionFolder = await ctx.db.get(folderId);
  if (!collectionFolder) return null;

  const approvedTag = await ctx.db
    .query("tags")
    .withIndex("by_normalized", (q) =>
      q.eq("normalized", normalizeTagName(APPROVED_TAG_NAME)),
    )
    .unique();
  const approvedTagId = approvedTag?._id;

  const members = await collectAssetsForFolder(
    ctx,
    ownerUserIds,
    folderId,
    BOARD_COLLECTION_ASSET_LIMIT,
  );
  const assets = await Promise.all(
    members.map(async (asset) => {
      const [url, thumbUrl] = await Promise.all([
        resolveAssetUrl(ctx, asset),
        resolveAssetThumbUrl(ctx, asset),
      ]);
      return {
        id: asset._id,
        kind: asset.kind,
        contentType: asset.contentType,
        url: url ?? undefined,
        thumbUrl: thumbUrl ?? undefined,
        width: asset.width,
        height: asset.height,
        fileName: asset.fileName,
        title: asset.description,
        approved: approvedTagId ? asset.tagIds.includes(approvedTagId) : false,
        createdAt: asset.createdAt,
      };
    }),
  );

  return {
    projectName: projectFolder.name,
    direction: {
      id: folderId,
      name: collectionFolder.name,
      coverAssetId: collectionFolder.coverAssetId,
      assets,
    },
  };
};

/**
 * PUBLIC: one direction of a shared board, token-gated. Backs the
 * /api/board/direction-pdf export.
 */
export const getBoardDirection = query({
  args: {
    token: v.string(),
    folderId: v.id("folders"),
  },
  returns: directionPayloadValidator,
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!token) return null;
    const folder = await ctx.db
      .query("folders")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", token))
      .unique();
    if (!folder || folder.kind !== "project") return null;
    return await resolveDirectionPayload(ctx, folder, args.folderId);
  },
});

/**
 * Owner-side twin of getBoardDirection — same trimmed payload, gated by
 * ownerUserId instead of a share token. Backs /api/projects/direction-pdf.
 */
export const getOwnerDirection = query({
  args: {
    ownerUserId: v.string(),
    projectId: v.id("folders"),
    folderId: v.id("folders"),
  },
  returns: directionPayloadValidator,
  handler: async (ctx, args) => {
    const folder = await requireOwnedProject(
      ctx,
      args.ownerUserId,
      args.projectId,
    );
    return await resolveDirectionPayload(ctx, folder, args.folderId);
  },
});

/**
 * PUBLIC: resolve a shared direction board by its token. No auth — the
 * unguessable token IS the capability. Returns null for unknown/revoked
 * tokens so the page can render a clean "link not active" state.
 */
export const getBoard = query({
  args: {
    token: v.string(),
  },
  returns: v.union(v.null(), boardValidator),
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!token) return null;

    const folder = await ctx.db
      .query("folders")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", token))
      .unique();
    if (!folder || folder.kind !== "project" || !folder.ownerUserId) {
      return null;
    }

    const ownerUserIds = resolveUserIdCandidates(folder.ownerUserId);
    const collectionLinks = await collectProjectCollectionLinks(
      ctx,
      ownerUserIds,
      folder._id,
    );

    const approvedTag = await ctx.db
      .query("tags")
      .withIndex("by_normalized", (q) =>
        q.eq("normalized", normalizeTagName(APPROVED_TAG_NAME)),
      )
      .unique();
    const approvedTagId = approvedTag?._id;

    const collections = await Promise.all(
      collectionLinks.map(
        async ({
          folderId,
          section,
          beatCharacterFolderId,
          beatLocationFolderId,
        }) => {
        const collectionFolder = await ctx.db.get(folderId);
        const members = await collectAssetsForFolder(
          ctx,
          ownerUserIds,
          folderId,
          BOARD_COLLECTION_ASSET_LIMIT,
        );
        const assets = await Promise.all(
          members.map(async (asset) => {
            const [url, thumbUrl] = await Promise.all([
              resolveAssetUrl(ctx, asset),
              resolveAssetThumbUrl(ctx, asset),
            ]);
            return {
              id: asset._id,
              kind: asset.kind,
              contentType: asset.contentType,
              url: url ?? undefined,
              thumbUrl: thumbUrl ?? undefined,
              width: asset.width,
              height: asset.height,
              fileName: asset.fileName,
              title: asset.description,
              approved: approvedTagId
                ? asset.tagIds.includes(approvedTagId)
                : false,
              createdAt: asset.createdAt,
            };
          }),
        );
        return {
          id: folderId,
          name: collectionFolder?.name ?? "Untitled collection",
          section,
          coverAssetId: collectionFolder?.coverAssetId,
          beatCharacterFolderId,
          beatLocationFolderId,
          count: assets.length,
          assets,
        };
        },
      ),
    );

    return {
      name: folder.name,
      brief: folder.description,
      updatedAt: folder.updatedAt,
      collections,
    };
  },
});
