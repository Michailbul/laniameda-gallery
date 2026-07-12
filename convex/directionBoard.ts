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
// Base shape shared with the PDF direction payload (which needs no likes).
const directionAssetValidator = v.object({
  id: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  contentType: v.optional(v.string()),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  thumbWidth: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  fileName: v.optional(v.string()),
  title: v.optional(v.string()),
  approved: v.boolean(),
  createdAt: v.number(),
});

const boardAssetValidator = v.object({
  ...directionAssetValidator.fields,
  likeCount: v.number(),
  likedByMe: v.boolean(),
  // Tag names, so viewers can filter the expanded views by metadata.
  tags: v.array(v.string()),
});

const boardValidator = v.object({
  name: v.string(),
  brief: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
  collections: v.array(
    v.object({
      id: v.id("folders"),
      name: v.string(),
      description: v.optional(v.string()),
      section: optionalProjectSectionValidator,
      coverAssetId: v.optional(v.id("assets")),
      // Which character / location directions a beat uses.
      beatCharacterFolderIds: v.array(v.id("folders")),
      beatLocationFolderIds: v.array(v.id("folders")),
      // Whole-direction likes (the Like button on a beat).
      likeCount: v.number(),
      likedByMe: v.boolean(),
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

// Resolve a share token to its project folder, or null.
const resolveSharedProject = async (
  ctx: QueryCtx | MutationCtx,
  rawToken: string,
): Promise<Doc<"folders"> | null> => {
  const token = rawToken.trim();
  if (!token) return null;
  const folder = await ctx.db
    .query("folders")
    .withIndex("by_shareToken", (q) => q.eq("shareToken", token))
    .unique();
  if (!folder || folder.kind !== "project" || !folder.ownerUserId) {
    return null;
  }
  return folder;
};

// Does this asset belong to one of the shared project's member collections?
const assetInSharedProject = async (
  ctx: QueryCtx | MutationCtx,
  folder: Doc<"folders">,
  asset: Doc<"assets">,
): Promise<boolean> => {
  const ownerUserIds = resolveUserIdCandidates(folder.ownerUserId!);
  if (!asset.ownerUserId || !ownerUserIds.includes(asset.ownerUserId)) {
    return false;
  }
  const collectionIds = new Set<string>(
    await collectProjectCollectionIds(ctx, ownerUserIds, folder._id),
  );
  if (asset.folderId && collectionIds.has(asset.folderId)) return true;
  const links = await ctx.db
    .query("assetFolders")
    .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
    .collect();
  return links.some((link) => collectionIds.has(link.folderId));
};

/**
 * PUBLIC: toggle an authless viewer like on a shared-board asset. The share
 * token is the capability; viewerKey is a random client id from the viewer's
 * localStorage so the same browser can un-like. Likes are stored on the
 * project owner's account (beta — no viewer auth).
 */
export const toggleBoardLike = mutation({
  args: {
    token: v.string(),
    // Exactly one target: an asset, or a whole direction (a beat card).
    assetId: v.optional(v.id("assets")),
    folderId: v.optional(v.id("folders")),
    viewerKey: v.string(),
    viewerName: v.optional(v.string()),
  },
  returns: v.object({ liked: v.boolean(), likeCount: v.number() }),
  handler: async (ctx, args) => {
    const viewerKey = args.viewerKey.trim();
    if (viewerKey.length < 8 || viewerKey.length > 64) {
      throw new ConvexError("Invalid viewer key.");
    }
    if (Boolean(args.assetId) === Boolean(args.folderId)) {
      throw new ConvexError("Pass exactly one of assetId / folderId.");
    }
    const folder = await resolveSharedProject(ctx, args.token);
    if (!folder) {
      throw new ConvexError("This link isn't active.");
    }

    if (args.assetId) {
      const asset = await ctx.db.get(args.assetId);
      if (!asset || !(await assetInSharedProject(ctx, folder, asset))) {
        throw new ConvexError("Asset is not on this board.");
      }
    } else if (args.folderId) {
      const ownerUserIds = resolveUserIdCandidates(folder.ownerUserId!);
      const memberIds = await collectProjectCollectionIds(
        ctx,
        ownerUserIds,
        folder._id,
      );
      if (!memberIds.includes(args.folderId)) {
        throw new ConvexError("Direction is not on this board.");
      }
    }

    const existing = args.assetId
      ? await ctx.db
          .query("boardReactions")
          .withIndex("by_project_viewer_asset", (q) =>
            q
              .eq("projectId", folder._id)
              .eq("viewerKey", viewerKey)
              .eq("assetId", args.assetId),
          )
          .unique()
      : await ctx.db
          .query("boardReactions")
          .withIndex("by_project_viewer_folder", (q) =>
            q
              .eq("projectId", folder._id)
              .eq("viewerKey", viewerKey)
              .eq("folderId", args.folderId),
          )
          .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    } else {
      await ctx.db.insert("boardReactions", {
        ownerUserId: folder.ownerUserId!,
        projectId: folder._id,
        assetId: args.assetId,
        folderId: args.folderId,
        viewerKey,
        viewerName: args.viewerName?.trim().slice(0, 40) || undefined,
        createdAt: Date.now(),
      });
    }

    const reactions = args.assetId
      ? await ctx.db
          .query("boardReactions")
          .withIndex("by_project_asset", (q) =>
            q.eq("projectId", folder._id).eq("assetId", args.assetId),
          )
          .collect()
      : await ctx.db
          .query("boardReactions")
          .withIndex("by_project_folder", (q) =>
            q.eq("projectId", folder._id).eq("folderId", args.folderId),
          )
          .collect();
    return { liked: !existing, likeCount: reactions.length };
  },
});

/**
 * PUBLIC: attach/refresh the viewer's display name on all their likes in this
 * board, so the owner sees "Lukas" instead of an anonymous count.
 */
export const setBoardViewerName = mutation({
  args: {
    token: v.string(),
    viewerKey: v.string(),
    name: v.string(),
  },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args) => {
    const viewerKey = args.viewerKey.trim();
    if (viewerKey.length < 8 || viewerKey.length > 64) {
      throw new ConvexError("Invalid viewer key.");
    }
    const folder = await resolveSharedProject(ctx, args.token);
    if (!folder) {
      throw new ConvexError("This link isn't active.");
    }
    const viewerName = args.name.trim().slice(0, 40) || undefined;
    const rows = await ctx.db
      .query("boardReactions")
      .withIndex("by_project_viewer", (q) =>
        q.eq("projectId", folder._id).eq("viewerKey", viewerKey),
      )
      .collect();
    for (const row of rows) {
      await ctx.db.patch(row._id, { viewerName });
    }
    return { updated: rows.length };
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
      assets: v.array(directionAssetValidator),
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
        thumbWidth: asset.thumbWidth,
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
    // The viewer's anonymous client id, to mark which assets they liked.
    viewerKey: v.optional(v.string()),
  },
  returns: v.union(v.null(), boardValidator),
  handler: async (ctx, args) => {
    const folder = await resolveSharedProject(ctx, args.token);
    if (!folder) return null;

    const viewerKey = args.viewerKey?.trim();
    const reactions = await ctx.db
      .query("boardReactions")
      .withIndex("by_project", (q) => q.eq("projectId", folder._id))
      .collect();
    const likeCountByAsset = new Map<string, number>();
    const likeCountByFolder = new Map<string, number>();
    const likedByViewer = new Set<string>();
    const likedFoldersByViewer = new Set<string>();
    for (const reaction of reactions) {
      if (reaction.assetId) {
        likeCountByAsset.set(
          reaction.assetId,
          (likeCountByAsset.get(reaction.assetId) ?? 0) + 1,
        );
        if (viewerKey && reaction.viewerKey === viewerKey) {
          likedByViewer.add(reaction.assetId);
        }
      } else if (reaction.folderId) {
        likeCountByFolder.set(
          reaction.folderId,
          (likeCountByFolder.get(reaction.folderId) ?? 0) + 1,
        );
        if (viewerKey && reaction.viewerKey === viewerKey) {
          likedFoldersByViewer.add(reaction.folderId);
        }
      }
    }

    const ownerUserIds = resolveUserIdCandidates(folder.ownerUserId!);
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

    // Tag-name cache shared across all member assets (ids repeat heavily).
    const tagNameById = new Map<string, string | null>();
    const resolveTagNames = async (tagIds: Id<"tags">[]) => {
      const names: string[] = [];
      for (const tagId of tagIds) {
        if (!tagNameById.has(tagId)) {
          const tag = await ctx.db.get(tagId);
          tagNameById.set(tagId, tag?.name ?? null);
        }
        const name = tagNameById.get(tagId);
        if (name && name !== APPROVED_TAG_NAME) names.push(name);
      }
      return names;
    };

    const collections = await Promise.all(
      collectionLinks.map(
        async ({
          folderId,
          section,
          beatCharacterFolderIds,
          beatLocationFolderIds,
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
              thumbWidth: asset.thumbWidth,
              width: asset.width,
              height: asset.height,
              fileName: asset.fileName,
              title: asset.description,
              approved: approvedTagId
                ? asset.tagIds.includes(approvedTagId)
                : false,
              likeCount: likeCountByAsset.get(asset._id) ?? 0,
              likedByMe: likedByViewer.has(asset._id),
              tags: await resolveTagNames(asset.tagIds),
              createdAt: asset.createdAt,
            };
          }),
        );
        return {
          id: folderId,
          name: collectionFolder?.name ?? "Untitled collection",
          description: collectionFolder?.description,
          section,
          coverAssetId: collectionFolder?.coverAssetId,
          beatCharacterFolderIds,
          beatLocationFolderIds,
          likeCount: likeCountByFolder.get(folderId) ?? 0,
          likedByMe: likedFoldersByViewer.has(folderId),
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
