import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { bumpTagUsage, dedupeIds } from "./helpers";

const promptTypeValidator = v.optional(v.union(
  v.literal("image_gen"),
  v.literal("video_gen"),
  v.literal("ui_design"),
  v.literal("cinematic"),
  v.literal("ugc_ad"),
  v.literal("other"),
));

export const createPrompt = mutation({
  args: {
    ownerUserId: v.string(),
    text: v.string(),
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    ingestKey: v.optional(v.string()),
    promptType: promptTypeValidator,
    domain: v.optional(v.string()),
  },
  returns: v.object({
    promptId: v.id("prompts"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const text = args.text.trim();
    if (!text) {
      throw new ConvexError("Prompt text is required.");
    }

    if (args.ingestKey) {
      const existing = await ctx.db
        .query("prompts")
        .withIndex("by_owner_ingestKey", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("ingestKey", args.ingestKey),
        )
        .unique();
      if (existing) {
        return { promptId: existing._id, created: false };
      }
    }

    const createdAt = Date.now();
    const tagIds = dedupeIds(args.tagIds);
    const promptId = await ctx.db.insert("prompts", {
      ownerUserId,
      text,
      tagIds,
      folderId: args.folderId,
      ingestKey: args.ingestKey,
      promptType: args.promptType,
      domain: args.domain,
      createdAt,
    });

    for (const tagId of tagIds) {
      await ctx.db.insert("promptTags", {
        promptId,
        tagId,
        createdAt,
      });
    }

    await bumpTagUsage(ctx, tagIds, 1);

    return { promptId, created: true };
  },
});

export const updatePrompt = mutation({
  args: {
    ownerUserId: v.string(),
    id: v.id("prompts"),
    text: v.string(),
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    promptType: promptTypeValidator,
    domain: v.optional(v.string()),
  },
  returns: v.id("prompts"),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const text = args.text.trim();
    if (!text) {
      throw new ConvexError("Prompt text is required.");
    }

    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError("Prompt not found.");
    }
    if (existing.ownerUserId !== ownerUserId) {
      throw new ConvexError("Prompt does not belong to this user.");
    }

    const tagIds = dedupeIds(args.tagIds);
    await ctx.db.patch(args.id, {
      text,
      tagIds,
      folderId: args.folderId,
      promptType: args.promptType,
      domain: args.domain,
    });

    await bumpTagUsage(ctx, existing.tagIds, -1);
    await bumpTagUsage(ctx, tagIds, 1);

    const links = await ctx.db
      .query("promptTags")
      .withIndex("by_prompt", (q) => q.eq("promptId", args.id))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
    for (const tagId of tagIds) {
      await ctx.db.insert("promptTags", {
        promptId: args.id,
        tagId,
        createdAt: existing.createdAt,
      });
    }

    return args.id;
  },
});

export const getPrompt = query({
  args: {
    id: v.id("prompts"),
    ownerUserId: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("prompts"),
      _creationTime: v.number(),
      ownerUserId: v.optional(v.string()),
      text: v.string(),
      tagIds: v.array(v.id("tags")),
      folderId: v.optional(v.id("folders")),
      ingestKey: v.optional(v.string()),
      promptType: promptTypeValidator,
      domain: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const prompt = await ctx.db.get(args.id);
    if (!prompt) {
      return null;
    }
    if (args.ownerUserId && prompt.ownerUserId !== args.ownerUserId) {
      return null;
    }
    return prompt;
  },
});

export const listPrompts = query({
  args: {
    ownerUserId: v.string(),
    tagId: v.optional(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("prompts"),
      _creationTime: v.number(),
      ownerUserId: v.optional(v.string()),
      text: v.string(),
      tagIds: v.array(v.id("tags")),
      folderId: v.optional(v.id("folders")),
      ingestKey: v.optional(v.string()),
      promptType: promptTypeValidator,
      domain: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const limit = Math.min(args.limit ?? 50, 200);
    const tagId = args.tagId;
    if (tagId) {
      const links = await ctx.db
        .query("promptTags")
        .withIndex("by_tag_createdAt", (q) =>
          q.eq("tagId", tagId).gte("createdAt", 0),
        )
        .order("desc")
        .take(limit);
      const results = [];
      for (const link of links) {
        const prompt = await ctx.db.get(link.promptId);
        if (prompt && prompt.ownerUserId === ownerUserId) {
          results.push(prompt);
        }
      }
      return results;
    }
    if (args.folderId) {
      return await ctx.db
        .query("prompts")
        .withIndex("by_owner_folder_createdAt", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("folderId", args.folderId).gte("createdAt", 0),
        )
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("prompts")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", ownerUserId).gte("createdAt", 0))
      .order("desc")
      .take(limit);
  },
});

export const searchPrompts = query({
  args: { ownerUserId: v.string(), query: v.string(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("prompts"),
      _creationTime: v.number(),
      ownerUserId: v.optional(v.string()),
      text: v.string(),
      tagIds: v.array(v.id("tags")),
      folderId: v.optional(v.id("folders")),
      ingestKey: v.optional(v.string()),
      promptType: promptTypeValidator,
      domain: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const query = args.query.trim();
    if (!query) return [];
    const limit = Math.min(args.limit ?? 20, 50);
    const rows = await ctx.db
      .query("prompts")
      .withSearchIndex("search_text", (q) => q.search("text", query))
      .take(limit * 3);
    const results = rows.filter((row) => row.ownerUserId === ownerUserId);
    return results.slice(0, limit);
  },
});
