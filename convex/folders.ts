import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import {
  canonicalFolderName,
  normalizeFolderName,
} from "./folderHelpers";

const folderReturnValidator = v.object({
  _id: v.id("folders"),
  _creationTime: v.number(),
  ownerUserId: v.optional(v.string()),
  name: v.string(),
  normalizedName: v.optional(v.string()),
  description: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});

export const createFolder = mutation({
  args: {
    ownerUserId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
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

    const name = normalizeFolderName(args.name);
    if (!name) {
      throw new ConvexError("Folder name is required.");
    }

    const normalizedName = canonicalFolderName(name);
    const hasDescription = args.description !== undefined;
    const description = hasDescription
      ? args.description?.trim() || undefined
      : undefined;
    const existing = await ctx.db
      .query("folders")
      .withIndex("by_owner_normalizedName", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("normalizedName", normalizedName),
      )
      .unique();
    if (existing) {
      const nextDescription = hasDescription
        ? description
        : existing.description;
      if (
        existing.name !== name ||
        existing.description !== nextDescription ||
        existing.normalizedName !== normalizedName
      ) {
        const now = Date.now();
        await ctx.db.patch(existing._id, {
          name,
          description: nextDescription,
          normalizedName,
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

    return await ctx.db
      .query("folders")
      .withIndex("by_owner_normalizedName", (q) =>
        q.eq("ownerUserId", ownerUserId).gte("normalizedName", ""),
      )
      .collect();
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

    const name = normalizeFolderName(args.name);
    if (!name) {
      throw new ConvexError("Folder name is required.");
    }

    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      throw new ConvexError("Folder not found.");
    }
    if (folder.ownerUserId !== ownerUserId) {
      throw new ConvexError("Folder does not belong to this user.");
    }

    const normalizedName = canonicalFolderName(name);
    const duplicate = await ctx.db
      .query("folders")
      .withIndex("by_owner_normalizedName", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("normalizedName", normalizedName),
      )
      .unique();
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

    const folder = await ctx.db.get(args.folderId);
    if (!folder) {
      return {
        folderId: args.folderId,
        deleted: false,
        assetsUpdated: 0,
        promptsUpdated: 0,
      };
    }
    if (folder.ownerUserId !== ownerUserId) {
      throw new ConvexError("Folder does not belong to this user.");
    }

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_owner_folder_createdAt", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("folderId", args.folderId).gte("createdAt", 0),
      )
      .collect();
    for (const asset of assets) {
      await ctx.db.patch(asset._id, { folderId: undefined });
    }

    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_owner_folder_createdAt", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("folderId", args.folderId).gte("createdAt", 0),
      )
      .collect();
    for (const prompt of prompts) {
      await ctx.db.patch(prompt._id, { folderId: undefined });
    }

    await ctx.db.delete(args.folderId);

    return {
      folderId: args.folderId,
      deleted: true,
      assetsUpdated: assets.length,
      promptsUpdated: prompts.length,
    };
  },
});
