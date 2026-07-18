import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  canonicalFolderName,
  normalizeFolderName,
} from "./folderHelpers";
import {
  canActorAccessOwnerUserId,
  resolveUserIdCandidates,
} from "./authz";
import { collectAssetsForFolder } from "./assets";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";

export const folderKindValidator = v.optional(
  v.union(
    v.literal("storybook"),
    v.literal("project"),
    v.literal("direction"),
  ),
);

const folderReturnValidator = v.object({
  _id: v.id("folders"),
  _creationTime: v.number(),
  ownerUserId: v.optional(v.string()),
  name: v.string(),
  normalizedName: v.optional(v.string()),
  description: v.optional(v.string()),
  kind: folderKindValidator,
  parentFolderId: v.optional(v.id("folders")),
  shareToken: v.optional(v.string()),
  coverAssetId: v.optional(v.id("assets")),
  pinnedAt: v.optional(v.number()),
  showcased: v.optional(v.boolean()),
  showcaseFeatured: v.optional(v.boolean()),
  showcaseOrder: v.optional(v.number()),
  tasteCollection: v.optional(v.boolean()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});

// Sub-collection names are unique per parent, not globally: "Characters" can
// exist under several story collections. Namespacing the canonical name with
// the parent id keeps the by_owner_normalizedName uniqueness (and the ingest
// name-resolution path, which only ever targets root collections) intact.
const scopedNormalizedName = (
  name: string,
  parentFolderId: string | undefined,
) =>
  parentFolderId
    ? `${parentFolderId}/${canonicalFolderName(name)}`
    : canonicalFolderName(name);

// Guard shared by createFolder / setFolderParent: a valid parent is an owned,
// plain, root-level collection. Keeps nesting to exactly one level.
const assertValidParent = async (
  ctx: MutationCtx,
  ownerUserId: string,
  parentFolderId: Id<"folders">,
) => {
  const parent = await ctx.db.get(parentFolderId);
  if (!parent) {
    throw new ConvexError("Parent collection not found.");
  }
  if (!canActorAccessOwnerUserId(ownerUserId, parent.ownerUserId)) {
    throw new ConvexError("Parent collection does not belong to this user.");
  }
  if (parent.kind !== undefined) {
    throw new ConvexError("Only plain collections can contain sub-collections.");
  }
  if (parent.parentFolderId !== undefined) {
    throw new ConvexError("Sub-collections can't be nested further.");
  }
  return parent;
};

const dedupeById = <T extends { _id: string }>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row._id)) return false;
    seen.add(row._id);
    return true;
  });
};

export const createFolder = mutation({
  args: {
    ownerUserId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    kind: folderKindValidator,
    // Create as a sub-collection of this plain, root-level collection.
    parentFolderId: v.optional(v.id("folders")),
  },
  returns: v.object({
    folderId: v.id("folders"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);

    const name = normalizeFolderName(args.name);
    if (!name) {
      throw new ConvexError("Folder name is required.");
    }

    if (args.parentFolderId !== undefined) {
      if (args.kind !== undefined) {
        throw new ConvexError("Only plain collections can be sub-collections.");
      }
      await assertValidParent(ctx, ownerUserId, args.parentFolderId);
    }

    const normalizedName = scopedNormalizedName(name, args.parentFolderId);
    const hasDescription = args.description !== undefined;
    const description = hasDescription
      ? args.description?.trim() || undefined
      : undefined;
    let existing = null;
    for (const ownerCandidate of ownerUserIds) {
      existing = await ctx.db
        .query("folders")
        .withIndex("by_owner_normalizedName", (q) =>
          q.eq("ownerUserId", ownerCandidate).eq("normalizedName", normalizedName),
        )
        .unique();
      if (existing) {
        break;
      }
    }
    if (existing) {
      const nextDescription = hasDescription
        ? description
        : existing.description;
      const nextKind = args.kind ?? existing.kind;
      if (
        existing.name !== name ||
        existing.description !== nextDescription ||
        existing.normalizedName !== normalizedName ||
        existing.kind !== nextKind
      ) {
        const now = Date.now();
        await ctx.db.patch(existing._id, {
          name,
          description: nextDescription,
          normalizedName,
          kind: nextKind,
          createdAt: existing.createdAt ?? now,
          updatedAt: now,
        });
      }
      return { folderId: existing._id, created: false };
    }

    const now = Date.now();
    const folderId = await ctx.db.insert("folders", {
      ownerUserId,
      name,
      normalizedName,
      description,
      kind: args.kind,
      parentFolderId: args.parentFolderId,
      createdAt: now,
      updatedAt: now,
    });

    return { folderId, created: true };
  },
});

export const listFolders = query({
  args: {
    ownerUserId: v.string(),
  },
  returns: v.array(folderReturnValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
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

    return dedupeById(folders).sort((left, right) =>
      String(left.normalizedName ?? "").localeCompare(String(right.normalizedName ?? "")),
    );
  },
});

export const updateFolder = mutation({
  args: {
    ownerUserId: v.string(),
    folderId: v.id("folders"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.id("folders"),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);

    const name = normalizeFolderName(args.name);
    if (!name) {
      throw new ConvexError("Folder name is required.");
    }

    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new ConvexError("Folder not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
      throw new ConvexError("Folder does not belong to this user.");
    }

    const normalizedName = scopedNormalizedName(name, folder.parentFolderId);
    let duplicate = null;
    for (const ownerCandidate of ownerUserIds) {
      duplicate = await ctx.db
        .query("folders")
        .withIndex("by_owner_normalizedName", (q) =>
          q.eq("ownerUserId", ownerCandidate).eq("normalizedName", normalizedName),
        )
        .unique();
      if (duplicate) {
        break;
      }
    }
    if (duplicate && duplicate._id !== args.folderId) {
      throw new ConvexError("A folder with this name already exists.");
    }

    const description = args.description === undefined
      ? folder.description
      : args.description.trim() || undefined;

    await ctx.db.patch(args.folderId, {
      name,
      normalizedName,
      description,
      updatedAt: Date.now(),
    });

    return args.folderId;
  },
});

// Pin/unpin a direction (beat/stack) in the project workspace — pinned
// cards float first in their mode.
export const setFolderPinned = mutation({
  args: {
    ownerUserId: v.string(),
    folderId: v.id("folders"),
    pinned: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new ConvexError("Folder not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
      throw new ConvexError("Folder does not belong to this user.");
    }
    await ctx.db.patch(args.folderId, {
      pinnedAt: args.pinned ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Toggle a collection or storybook onto the public "My Taste" showcase home.
// Projects and project-scoped directions can never be showcased — they stay
// private and are shared only via a shareToken board.
export const setFolderShowcased = mutation({
  args: {
    ownerUserId: v.string(),
    folderId: v.id("folders"),
    showcased: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new ConvexError("Folder not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
      throw new ConvexError("Folder does not belong to this user.");
    }
    if (folder.kind === "project" || folder.kind === "direction") {
      throw new ConvexError(
        "Projects can't be showcased publicly — share them via a board link instead.",
      );
    }
    if (folder.parentFolderId !== undefined) {
      throw new ConvexError(
        "Sub-collections are shown inside their parent — showcase the parent collection instead.",
      );
    }
    await ctx.db.patch(args.folderId, {
      // Store the flag only when on; clearing it keeps the by_showcased index
      // free of stale `false` rows. Un-showcasing also drops featured.
      showcased: args.showcased ? true : undefined,
      showcaseFeatured: args.showcased ? folder.showcaseFeatured : undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Feature a showcased set on the public home (large hero treatment above the
// regular stacks). Featuring implies showcasing; un-featuring keeps the set
// showcased as a regular stack.
export const setFolderFeatured = mutation({
  args: {
    ownerUserId: v.string(),
    folderId: v.id("folders"),
    featured: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new ConvexError("Folder not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
      throw new ConvexError("Folder does not belong to this user.");
    }
    if (folder.kind === "project" || folder.kind === "direction") {
      throw new ConvexError("Projects can't be featured publicly.");
    }
    if (folder.parentFolderId !== undefined) {
      throw new ConvexError(
        "Sub-collections are shown inside their parent — feature the parent collection instead.",
      );
    }
    await ctx.db.patch(args.folderId, {
      showcased: args.featured ? true : folder.showcased,
      showcaseFeatured: args.featured ? true : undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Mark a plain collection as THE taste collection: its members are exactly
// what the public showcase home's inspiration grid shows. At most one per
// owner — setting it clears the flag from any other folder.
export const setTasteCollection = mutation({
  args: {
    ownerUserId: v.string(),
    folderId: v.id("folders"),
    taste: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new ConvexError("Folder not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
      throw new ConvexError("Folder does not belong to this user.");
    }
    if (folder.kind !== undefined) {
      throw new ConvexError(
        "Only a plain collection can be the taste collection.",
      );
    }
    if (args.taste) {
      const current = await ctx.db
        .query("folders")
        .withIndex("by_tasteCollection", (q) => q.eq("tasteCollection", true))
        .collect();
      for (const other of current) {
        if (other._id === args.folderId) continue;
        if (!canActorAccessOwnerUserId(ownerUserId, other.ownerUserId)) continue;
        await ctx.db.patch(other._id, {
          tasteCollection: undefined,
          updatedAt: Date.now(),
        });
      }
    }
    await ctx.db.patch(args.folderId, {
      // Store the flag only when on, keeping the index free of stale rows.
      tasteCollection: args.taste ? true : undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Nest a collection under a parent (or lift it back to root with null).
// One level only: the moved collection must not have children of its own.
export const setFolderParent = mutation({
  args: {
    ownerUserId: v.string(),
    folderId: v.id("folders"),
    parentFolderId: v.union(v.id("folders"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new ConvexError("Folder not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
      throw new ConvexError("Folder does not belong to this user.");
    }
    if (folder.kind !== undefined) {
      throw new ConvexError("Only plain collections can be nested.");
    }

    const nextParentId =
      args.parentFolderId === null ? undefined : args.parentFolderId;
    if (nextParentId === folder.parentFolderId) return null;

    if (nextParentId !== undefined) {
      if (nextParentId === args.folderId) {
        throw new ConvexError("A collection can't be nested inside itself.");
      }
      await assertValidParent(ctx, ownerUserId, nextParentId);
      const children = await ctx.db
        .query("folders")
        .withIndex("by_parent", (q) => q.eq("parentFolderId", args.folderId))
        .take(1);
      if (children.length > 0) {
        throw new ConvexError(
          "This collection has sub-collections of its own — lift those out first.",
        );
      }
    }

    // Re-scope the canonical name to the new parent; refuse on collision.
    const normalizedName = scopedNormalizedName(folder.name, nextParentId);
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    for (const ownerCandidate of ownerUserIds) {
      const duplicate = await ctx.db
        .query("folders")
        .withIndex("by_owner_normalizedName", (q) =>
          q.eq("ownerUserId", ownerCandidate).eq("normalizedName", normalizedName),
        )
        .unique();
      if (duplicate && duplicate._id !== args.folderId) {
        throw new ConvexError(
          "A collection with this name already exists at that level.",
        );
      }
    }

    await ctx.db.patch(args.folderId, {
      parentFolderId: nextParentId,
      normalizedName,
      // A nested collection is never independently showcased.
      showcased: nextParentId !== undefined ? undefined : folder.showcased,
      showcaseFeatured:
        nextParentId !== undefined ? undefined : folder.showcaseFeatured,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const deleteFolder = mutation({
  args: {
    ownerUserId: v.string(),
    folderId: v.id("folders"),
  },
  returns: v.object({
    folderId: v.id("folders"),
    deleted: v.boolean(),
    assetsUpdated: v.number(),
    promptsUpdated: v.number(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);

    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      return {
        folderId: args.folderId,
        deleted: false,
        assetsUpdated: 0,
        promptsUpdated: 0,
      };
    }
    if (!canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
      throw new ConvexError("Folder does not belong to this user.");
    }

    const assets = [];
    const assetFolderLinks = [];
    for (const ownerCandidate of ownerUserIds) {
      const assetsForOwner = await ctx.db
        .query("assets")
        .withIndex("by_owner_folder_createdAt", (q) =>
          q.eq("ownerUserId", ownerCandidate).eq("folderId", args.folderId).gte("createdAt", 0),
        )
        .collect();
      assets.push(...assetsForOwner);

      const linksForOwner = await ctx.db
        .query("assetFolders")
        .withIndex("by_owner_folder_createdAt", (q) =>
          q.eq("ownerUserId", ownerCandidate).eq("folderId", args.folderId).gte("createdAt", 0),
        )
        .collect();
      assetFolderLinks.push(...linksForOwner);
      for (const link of linksForOwner) {
        const asset = await ctx.db.get(link.assetId);
        if (asset) {
          assets.push(asset);
        }
      }
    }
    for (const asset of dedupeById(assets)) {
      if (asset.folderId === args.folderId) {
        await ctx.db.patch(asset._id, { folderId: undefined });
      }
    }
    for (const link of dedupeById(assetFolderLinks)) {
      await ctx.db.delete(link._id);
    }

    const prompts = [];
    for (const ownerCandidate of ownerUserIds) {
      const promptsForOwner = await ctx.db
        .query("prompts")
        .withIndex("by_owner_folder_createdAt", (q) =>
          q.eq("ownerUserId", ownerCandidate).eq("folderId", args.folderId).gte("createdAt", 0),
        )
        .collect();
      prompts.push(...promptsForOwner);
    }
    for (const prompt of prompts) {
      await ctx.db.patch(prompt._id, { folderId: undefined });
    }

    // Clear projectCollections rows both ways: this folder as the project
    // being deleted, and this folder as a member collection of any project.
    const projectLinks = [
      ...(await ctx.db
        .query("projectCollections")
        .withIndex("by_project", (q) => q.eq("projectId", args.folderId))
        .collect()),
      ...(await ctx.db
        .query("projectCollections")
        .withIndex("by_folder", (q) => q.eq("folderId", args.folderId))
        .collect()),
    ];
    for (const link of dedupeById(projectLinks)) {
      await ctx.db.delete(link._id);
    }

    // Promote sub-collections to root instead of orphaning them. Their
    // canonical name is re-scoped; on a rare root-level name collision the
    // old (parent-prefixed) normalizedName is kept — still unique, and only
    // used for dedupe/sort.
    const children = await ctx.db
      .query("folders")
      .withIndex("by_parent", (q) => q.eq("parentFolderId", args.folderId))
      .collect();
    for (const child of children) {
      const rootName = canonicalFolderName(child.name);
      let collision = null;
      for (const ownerCandidate of ownerUserIds) {
        collision = await ctx.db
          .query("folders")
          .withIndex("by_owner_normalizedName", (q) =>
            q.eq("ownerUserId", ownerCandidate).eq("normalizedName", rootName),
          )
          .unique();
        if (collision) break;
      }
      await ctx.db.patch(child._id, {
        parentFolderId: undefined,
        ...(collision && collision._id !== child._id
          ? {}
          : { normalizedName: rootName }),
        updatedAt: Date.now(),
      });
    }

    await ctx.db.delete(args.folderId);

    return {
      folderId: args.folderId,
      deleted: true,
      assetsUpdated: dedupeById(assets).length,
      promptsUpdated: dedupeById(prompts).length,
    };
  },
});

// How many member thumbnails a collection card gets in the collections view.
const COLLECTION_PREVIEW_LIMIT = 4;
// How deep to walk membership when building a card (enough to front the
// cover and fill the preview stack — counts come from folderAssetCounts).
const COLLECTION_PREVIEW_SCAN = 24;

const collectionPreviewValidator = v.object({
  assetId: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  contentType: v.optional(v.string()),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});

/**
 * Card data for the gallery's "collections" browse view: every plain
 * collection (roots AND sub-collections; the client nests by parentFolderId)
 * with up to four preview thumbs, the chosen cover first. Counts are NOT
 * computed here — the dashboard already subscribes to folderAssetCounts.
 */
export const listCollectionSummaries = query({
  args: {
    ownerUserId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("folders"),
      name: v.string(),
      description: v.optional(v.string()),
      parentFolderId: v.optional(v.id("folders")),
      updatedAt: v.optional(v.number()),
      createdAt: v.optional(v.number()),
      previewAssets: v.array(collectionPreviewValidator),
    }),
  ),
  handler: async (ctx: QueryCtx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);

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
    const collections = dedupeById(folders).filter(
      (folder) => folder.kind === undefined,
    );

    return await Promise.all(
      collections.map(async (folder) => {
        const members = await collectAssetsForFolder(
          ctx,
          ownerUserIds,
          folder._id,
          COLLECTION_PREVIEW_SCAN,
        );
        // The chosen cover fronts the preview stack when set and present.
        if (folder.coverAssetId) {
          const idx = members.findIndex((a) => a._id === folder.coverAssetId);
          if (idx > 0) {
            const [cover] = members.splice(idx, 1);
            members.unshift(cover);
          }
        }
        const previewAssets = await Promise.all(
          members.slice(0, COLLECTION_PREVIEW_LIMIT).map(async (asset) => {
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
            };
          }),
        );
        return {
          _id: folder._id,
          name: folder.name,
          description: folder.description,
          parentFolderId: folder.parentFolderId,
          updatedAt: folder.updatedAt,
          createdAt: folder.createdAt,
          previewAssets,
        };
      }),
    );
  },
});

// Set or clear the MASTER option (cover asset) of a collection — the
// thumbnail used when the collection is browsed as a "direction" (a set of
// similar options). The asset must actually be in the collection, via the
// primary folderId or an assetFolders link.
export const setFolderCover = mutation({
  args: {
    ownerUserId: v.string(),
    folderId: v.id("folders"),
    assetId: v.union(v.id("assets"), v.null()),
  },
  returns: v.object({ coverAssetId: v.union(v.id("assets"), v.null()) }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new ConvexError("Folder not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
      throw new ConvexError("Folder does not belong to this user.");
    }

    if (args.assetId === null) {
      await ctx.db.patch(folder._id, {
        coverAssetId: undefined,
        updatedAt: Date.now(),
      });
      return { coverAssetId: null };
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }
    let isMember = asset.folderId === args.folderId;
    if (!isMember) {
      const link = await ctx.db
        .query("assetFolders")
        .withIndex("by_asset_folder", (q) =>
          q.eq("assetId", asset._id).eq("folderId", args.folderId),
        )
        .unique();
      isMember = Boolean(link);
    }
    if (!isMember) {
      throw new ConvexError("Asset is not in this collection.");
    }

    await ctx.db.patch(folder._id, {
      coverAssetId: asset._id,
      updatedAt: Date.now(),
    });
    return { coverAssetId: asset._id };
  },
});
