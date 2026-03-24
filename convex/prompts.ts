import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import { bumpTagUsage, dedupeIds } from "./helpers";
import { ensureFolderOwnership } from "./folderHelpers";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import {
  modelProviderValidator,
  optionalPillarValidator,
  promptProfileValidator,
  promptSectionsValidator,
  promptTypeValidator,
  workflowTypeValidator,
} from "./validators";

const pillarValidator = optionalPillarValidator;
const reindexPromptAction = makeFunctionReference<"action">(
  "semanticIndex:reindexPrompt",
);
const reindexAssetAction = makeFunctionReference<"action">(
  "semanticIndex:reindexAsset",
);
const reindexDesignInspirationAction = makeFunctionReference<"action">(
  "semanticIndex:reindexDesignInspiration",
);

const dedupePromptIds = <T extends { _id: string }>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row._id)) return false;
    seen.add(row._id);
    return true;
  });
};

const promptResultFields = {
  _id: v.id("prompts"),
  _creationTime: v.number(),
  ownerUserId: v.optional(v.string()),
  text: v.string(),
  tagIds: v.array(v.id("tags")),
  folderId: v.optional(v.id("folders")),
  ingestKey: v.optional(v.string()),
  pillar: pillarValidator,
  promptType: promptTypeValidator,
  domain: v.optional(v.string()),
  modelName: v.optional(v.string()),
  modelProvider: modelProviderValidator,
  workflowType: workflowTypeValidator,
  promptSections: promptSectionsValidator,
  promptProfile: promptProfileValidator,
  createdAt: v.number(),
} as const;

const promptOnlyGalleryResultValidator = v.object({
  ...promptResultFields,
  linkedAssetCount: v.number(),
  linkedDesignInspirationCount: v.number(),
});

const matchesPromptSearch = (
  prompt: {
    text: string;
    domain?: string;
    modelName?: string;
    pillar?: string;
    promptType?: string;
    workflowType?: string;
    promptSections?: { finalPrompt?: string };
  },
  query?: string,
) => {
  const needle = query?.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  return [
    prompt.text,
    prompt.promptSections?.finalPrompt,
    prompt.domain,
    prompt.modelName,
    prompt.pillar,
    prompt.promptType,
    prompt.workflowType,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
};

export const createPrompt = mutation({
  args: {
    ownerUserId: v.string(),
    text: v.string(),
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    ingestKey: v.optional(v.string()),
    pillar: pillarValidator,
    promptType: promptTypeValidator,
    domain: v.optional(v.string()),
    modelName: v.optional(v.string()),
    modelProvider: modelProviderValidator,
    workflowType: workflowTypeValidator,
    promptSections: promptSectionsValidator,
    promptProfile: promptProfileValidator,
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
    await ensureFolderOwnership(ctx, ownerUserId, args.folderId);

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
      pillar: args.pillar,
      promptType: args.promptType,
      domain: args.domain,
      modelName: args.modelName,
      modelProvider: args.modelProvider,
      workflowType: args.workflowType,
      promptSections: args.promptSections,
      promptProfile: args.promptProfile,
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
    await ctx.scheduler.runAfter(0, reindexPromptAction, { promptId });

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
    pillar: pillarValidator,
    promptType: promptTypeValidator,
    domain: v.optional(v.string()),
    modelName: v.optional(v.string()),
    modelProvider: modelProviderValidator,
    workflowType: workflowTypeValidator,
    promptSections: promptSectionsValidator,
    promptProfile: promptProfileValidator,
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
    if (!canActorAccessOwnerUserId(ownerUserId, existing.ownerUserId)) {
      throw new ConvexError("Prompt does not belong to this user.");
    }
    await ensureFolderOwnership(ctx, ownerUserId, args.folderId);

    const tagIds = dedupeIds(args.tagIds);
    await ctx.db.patch(args.id, {
      text,
      tagIds,
      folderId: args.folderId,
      pillar: args.pillar,
      promptType: args.promptType,
      domain: args.domain,
      modelName: args.modelName,
      modelProvider: args.modelProvider,
      workflowType: args.workflowType,
      promptSections: args.promptSections,
      promptProfile: args.promptProfile,
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

    await ctx.scheduler.runAfter(0, reindexPromptAction, { promptId: args.id });
    const linkedAssets = await ctx.db
      .query("assets")
      .withIndex("by_prompt_createdAt", (q) =>
        q.eq("promptId", args.id).gte("createdAt", 0),
      )
      .collect();
    const linkedDesignInspirations = await ctx.db
      .query("designInspirations")
      .withIndex("by_promptId", (q) => q.eq("promptId", args.id))
      .collect();
    for (const asset of linkedAssets) {
      await ctx.scheduler.runAfter(0, reindexAssetAction, {
        assetId: asset._id,
      });
    }
    for (const designInspiration of linkedDesignInspirations) {
      await ctx.scheduler.runAfter(0, reindexDesignInspirationAction, {
        designInspirationId: designInspiration._id,
      });
    }

    return args.id;
  },
});

export const getPromptIdForIngestKey = internalQuery({
  args: {
    ownerUserId: v.string(),
    ingestKey: v.string(),
  },
  returns: v.union(v.null(), v.id("prompts")),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    const ingestKey = args.ingestKey.trim();
    if (!ownerUserId || !ingestKey) {
      return null;
    }

    const existing = await ctx.db
      .query("prompts")
      .withIndex("by_owner_ingestKey", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("ingestKey", ingestKey),
      )
      .unique();

    return existing?._id ?? null;
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
      pillar: pillarValidator,
      promptType: promptTypeValidator,
      domain: v.optional(v.string()),
      modelName: v.optional(v.string()),
      modelProvider: modelProviderValidator,
      workflowType: workflowTypeValidator,
      promptSections: promptSectionsValidator,
      promptProfile: promptProfileValidator,
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const prompt = await ctx.db.get(args.id);
    if (!prompt) {
      return null;
    }
    if (args.ownerUserId && !canActorAccessOwnerUserId(args.ownerUserId, prompt.ownerUserId)) {
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
      pillar: pillarValidator,
      promptType: promptTypeValidator,
      domain: v.optional(v.string()),
      modelName: v.optional(v.string()),
      modelProvider: modelProviderValidator,
      workflowType: workflowTypeValidator,
      promptSections: promptSectionsValidator,
      promptProfile: promptProfileValidator,
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);

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
        if (prompt && canActorAccessOwnerUserId(ownerUserId, prompt.ownerUserId)) {
          results.push(prompt);
        }
      }
      return results;
    }
    if (args.folderId) {
      const results = [];
      for (const ownerCandidate of ownerUserIds) {
        const rows = await ctx.db
          .query("prompts")
          .withIndex("by_owner_folder_createdAt", (q) =>
            q.eq("ownerUserId", ownerCandidate).eq("folderId", args.folderId).gte("createdAt", 0),
          )
          .order("desc")
          .take(limit);
        results.push(...rows);
      }
      return dedupePromptIds(results)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    }

    const results = [];
    for (const ownerCandidate of ownerUserIds) {
      const rows = await ctx.db
        .query("prompts")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0))
        .order("desc")
        .take(limit);
      results.push(...rows);
    }

    return dedupePromptIds(results)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
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
      pillar: pillarValidator,
      promptType: promptTypeValidator,
      domain: v.optional(v.string()),
      modelName: v.optional(v.string()),
      modelProvider: modelProviderValidator,
      workflowType: workflowTypeValidator,
      promptSections: promptSectionsValidator,
      promptProfile: promptProfileValidator,
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
    const results = rows.filter((row) => canActorAccessOwnerUserId(ownerUserId, row.ownerUserId));
    return results.slice(0, limit);
  },
});

export const listPromptOnlyGalleryPrompts = query({
  args: {
    ownerUserId: v.string(),
    tagIds: v.optional(v.array(v.id("tags"))),
    folderId: v.optional(v.id("folders")),
    pillar: pillarValidator,
    modelName: v.optional(v.string()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(promptOnlyGalleryResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const limit = Math.min(args.limit ?? 200, 200);
    const requiredTagIds = new Set(args.tagIds ?? []);
    const results: Array<Doc<"prompts"> & {
      linkedAssetCount: number;
      linkedDesignInspirationCount: number;
    }> = [];

    for (const ownerCandidate of ownerUserIds) {
      const rows = args.folderId
        ? await ctx.db
            .query("prompts")
            .withIndex("by_owner_folder_createdAt", (q) =>
              q.eq("ownerUserId", ownerCandidate).eq("folderId", args.folderId).gte("createdAt", 0),
            )
            .order("desc")
            .collect()
        : args.pillar
          ? await ctx.db
              .query("prompts")
              .withIndex("by_owner_pillar_createdAt", (q) =>
                q.eq("ownerUserId", ownerCandidate).eq("pillar", args.pillar).gte("createdAt", 0),
              )
              .order("desc")
              .collect()
          : await ctx.db
              .query("prompts")
              .withIndex("by_owner_createdAt", (q) =>
                q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
              )
              .order("desc")
              .collect();

      for (const prompt of rows) {
        if (args.modelName && prompt.modelName !== args.modelName) {
          continue;
        }
        if (
          requiredTagIds.size > 0 &&
          !prompt.tagIds.some((tagId) => requiredTagIds.has(tagId))
        ) {
          continue;
        }
        if (!matchesPromptSearch(prompt, args.search)) {
          continue;
        }

        const [linkedAssets, linkedDesignInspirations] = await Promise.all([
          ctx.db
            .query("assets")
            .withIndex("by_owner_prompt_createdAt", (q) =>
              q.eq("ownerUserId", ownerCandidate).eq("promptId", prompt._id).gte("createdAt", 0),
            )
            .take(1),
          ctx.db
            .query("designInspirations")
            .withIndex("by_owner_promptId", (q) =>
              q.eq("ownerUserId", ownerCandidate).eq("promptId", prompt._id),
            )
            .take(1),
        ]);

        if (linkedAssets.length > 0 || linkedDesignInspirations.length > 0) {
          continue;
        }

        results.push({
          ...prompt,
          linkedAssetCount: 0,
          linkedDesignInspirationCount: 0,
        });
      }
    }

    return dedupePromptIds(results)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);
  },
});

export const deletePrompt = internalMutation({
  args: { id: v.id("prompts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const linkedAssets = await ctx.db
      .query("assets")
      .withIndex("by_prompt_createdAt", (q) =>
        q.eq("promptId", args.id).gte("createdAt", 0),
      )
      .collect();
    const linkedDesignInspirations = await ctx.db
      .query("designInspirations")
      .withIndex("by_promptId", (q) => q.eq("promptId", args.id))
      .collect();
    // Delete linked promptTags
    const links = await ctx.db
      .query("promptTags")
      .withIndex("by_prompt", (q) => q.eq("promptId", args.id))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
    for (const designInspiration of linkedDesignInspirations) {
      await ctx.db.patch(designInspiration._id, {
        promptId: undefined,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.delete(args.id);
    await ctx.scheduler.runAfter(0, reindexPromptAction, { promptId: args.id });
    for (const asset of linkedAssets) {
      await ctx.scheduler.runAfter(0, reindexAssetAction, {
        assetId: asset._id,
      });
    }
    for (const designInspiration of linkedDesignInspirations) {
      await ctx.scheduler.runAfter(0, reindexDesignInspirationAction, {
        designInspirationId: designInspiration._id,
      });
    }
    return null;
  },
});

export const bulkDeletePrompts = internalMutation({
  args: { ids: v.array(v.id("prompts")) },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for (const id of args.ids) {
      const linkedAssets = await ctx.db
        .query("assets")
        .withIndex("by_prompt_createdAt", (q) =>
          q.eq("promptId", id).gte("createdAt", 0),
        )
        .collect();
      const linkedDesignInspirations = await ctx.db
        .query("designInspirations")
        .withIndex("by_promptId", (q) => q.eq("promptId", id))
        .collect();
      const links = await ctx.db
        .query("promptTags")
        .withIndex("by_prompt", (q) => q.eq("promptId", id))
        .collect();
      for (const link of links) {
        await ctx.db.delete(link._id);
      }
      for (const designInspiration of linkedDesignInspirations) {
        await ctx.db.patch(designInspiration._id, {
          promptId: undefined,
          updatedAt: Date.now(),
        });
      }
      await ctx.db.delete(id);
      await ctx.scheduler.runAfter(0, reindexPromptAction, { promptId: id });
      for (const asset of linkedAssets) {
        await ctx.scheduler.runAfter(0, reindexAssetAction, {
          assetId: asset._id,
        });
      }
      for (const designInspiration of linkedDesignInspirations) {
        await ctx.scheduler.runAfter(0, reindexDesignInspirationAction, {
          designInspirationId: designInspiration._id,
        });
      }
      count++;
    }
    return count;
  },
});

