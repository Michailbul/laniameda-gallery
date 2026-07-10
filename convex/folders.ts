import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import {
  canonicalFolderName,
  normalizeFolderName,
} from "./folderHelpers";
import {
  canActorAccessOwnerUserId,
  resolveUserIdCandidates,
} from "./authz";

export const folderKindValidator = v.optional(
  v.union(v.literal("storybook"), v.literal("project")),
);

const folderReturnValidator = v.object({
  _id: v.id("folders"),
  _creationTime: v.number(),
  ownerUserId: v.optional(v.string()),
  name: v.string(),
  normalizedName: v.optional(v.string()),
  description: v.optional(v.string()),
  kind: folderKindValidator,
  shareToken: v.optional(v.string()),
  coverAssetId: v.optional(v.id("assets")),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});

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

    const normalizedName = canonicalFolderName(name);
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

    const normalizedName = canonicalFolderName(name);
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

    await ctx.db.delete(args.folderId);

    return {
      folderId: args.folderId,
      deleted: true,
      assetsUpdated: dedupeById(assets).length,
      promptsUpdated: dedupeById(prompts).length,
    };
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
