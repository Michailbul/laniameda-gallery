import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { canActorAccessOwnerUserId } from "./authz";
import { lineageRoleValidator } from "./validators";

const lineageDocValidator = v.object({
  _id: v.id("generationLineage"),
  _creationTime: v.number(),
  ownerUserId: v.string(),
  targetPromptId: v.optional(v.id("prompts")),
  targetAssetId: v.optional(v.id("assets")),
  sourcePromptId: v.optional(v.id("prompts")),
  sourceAssetId: v.optional(v.id("assets")),
  role: lineageRoleValidator,
  stageOrder: v.optional(v.number()),
  notes: v.optional(v.string()),
  createdAt: v.number(),
});

const hydratedLineageResultValidator = v.object({
  lineage: lineageDocValidator,
  sourcePrompt: v.union(v.null(), v.any()),
  sourceAsset: v.union(v.null(), v.any()),
  targetPrompt: v.union(v.null(), v.any()),
  targetAsset: v.union(v.null(), v.any()),
});

type LineageInput = {
  ownerUserId: string;
  targetPromptId?: Id<"prompts">;
  targetAssetId?: Id<"assets">;
  sourcePromptId?: Id<"prompts">;
  sourceAssetId?: Id<"assets">;
  role: Doc<"generationLineage">["role"];
  stageOrder?: number;
  notes?: string;
};

async function findExistingLineage(ctx: MutationCtx, input: LineageInput) {
  const indexField = input.targetAssetId
    ? ("by_targetAsset" as const)
    : input.targetPromptId
      ? ("by_targetPrompt" as const)
      : input.sourceAssetId
        ? ("by_sourceAsset" as const)
        : ("by_sourcePrompt" as const);

  const rows = await ctx.db
    .query("generationLineage")
    .withIndex(indexField, (q) => {
      if (indexField === "by_targetAsset") return q.eq("targetAssetId", input.targetAssetId!);
      if (indexField === "by_targetPrompt") return q.eq("targetPromptId", input.targetPromptId!);
      if (indexField === "by_sourceAsset") return q.eq("sourceAssetId", input.sourceAssetId!);
      return q.eq("sourcePromptId", input.sourcePromptId!);
    })
    .collect();

  return rows.find(
    (row) =>
      row.ownerUserId === input.ownerUserId &&
      row.targetPromptId === input.targetPromptId &&
      row.targetAssetId === input.targetAssetId &&
      row.sourcePromptId === input.sourcePromptId &&
      row.sourceAssetId === input.sourceAssetId &&
      row.role === input.role,
  );
}

export async function upsertLineageInternal(
  ctx: MutationCtx,
  input: LineageInput,
): Promise<{ lineageId: Id<"generationLineage">; created: boolean }> {
  if (!input.targetPromptId && !input.targetAssetId) {
    throw new ConvexError("Lineage requires a targetPromptId or targetAssetId.");
  }
  if (!input.sourcePromptId && !input.sourceAssetId) {
    throw new ConvexError("Lineage requires a sourcePromptId or sourceAssetId.");
  }

  const existing = await findExistingLineage(ctx, input);
  if (existing) {
    const patch: Partial<Doc<"generationLineage">> = {};
    if (input.stageOrder !== undefined && existing.stageOrder !== input.stageOrder) {
      patch.stageOrder = input.stageOrder;
    }
    if (input.notes !== undefined && existing.notes !== input.notes) {
      patch.notes = input.notes;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(existing._id, patch);
    }
    return { lineageId: existing._id, created: false };
  }

  const lineageId = await ctx.db.insert("generationLineage", {
    ownerUserId: input.ownerUserId,
    targetPromptId: input.targetPromptId,
    targetAssetId: input.targetAssetId,
    sourcePromptId: input.sourcePromptId,
    sourceAssetId: input.sourceAssetId,
    role: input.role,
    stageOrder: input.stageOrder,
    notes: input.notes,
    createdAt: Date.now(),
  });
  return { lineageId, created: true };
}

async function assertOwnedLineageEndpoint(
  ctx: MutationCtx,
  ownerUserId: string,
  input: {
    promptId?: Id<"prompts">;
    assetId?: Id<"assets">;
    label: string;
  },
) {
  if (input.promptId) {
    const prompt = await ctx.db.get(input.promptId);
    if (!prompt) {
      throw new ConvexError(`${input.label} prompt not found.`);
    }
    if (!canActorAccessOwnerUserId(ownerUserId, prompt.ownerUserId)) {
      throw new ConvexError(`${input.label} prompt does not belong to this user.`);
    }
  }

  if (input.assetId) {
    const asset = await ctx.db.get(input.assetId);
    if (!asset) {
      throw new ConvexError(`${input.label} asset not found.`);
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError(`${input.label} asset does not belong to this user.`);
    }
  }
}

export const upsertLineage = mutation({
  args: {
    ownerUserId: v.string(),
    targetPromptId: v.optional(v.id("prompts")),
    targetAssetId: v.optional(v.id("assets")),
    sourcePromptId: v.optional(v.id("prompts")),
    sourceAssetId: v.optional(v.id("assets")),
    role: lineageRoleValidator,
    stageOrder: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  returns: v.object({
    lineageId: v.id("generationLineage"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    await assertOwnedLineageEndpoint(ctx, ownerUserId, {
      promptId: args.targetPromptId,
      assetId: args.targetAssetId,
      label: "Target",
    });
    await assertOwnedLineageEndpoint(ctx, ownerUserId, {
      promptId: args.sourcePromptId,
      assetId: args.sourceAssetId,
      label: "Source",
    });
    return upsertLineageInternal(ctx, { ...args, ownerUserId });
  },
});

async function hydrateLineageRows(
  ctx: QueryCtx,
  rows: Doc<"generationLineage">[],
) {
  return Promise.all(
    rows.map(async (row) => {
      const [sourcePrompt, sourceAsset, targetPrompt, targetAsset] = await Promise.all([
        row.sourcePromptId ? ctx.db.get(row.sourcePromptId) : null,
        row.sourceAssetId ? ctx.db.get(row.sourceAssetId) : null,
        row.targetPromptId ? ctx.db.get(row.targetPromptId) : null,
        row.targetAssetId ? ctx.db.get(row.targetAssetId) : null,
      ]);
      return { lineage: row, sourcePrompt, sourceAsset, targetPrompt, targetAsset };
    }),
  );
}

export const getUpstreamForAsset = query({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
  },
  returns: v.array(hydratedLineageResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) return [];
    const rows = await ctx.db
      .query("generationLineage")
      .withIndex("by_targetAsset", (q) => q.eq("targetAssetId", args.assetId))
      .collect();
    const visible = rows.filter((row) =>
      canActorAccessOwnerUserId(ownerUserId, row.ownerUserId),
    );
    return hydrateLineageRows(ctx, visible);
  },
});

export const getUpstreamForPrompt = query({
  args: {
    ownerUserId: v.string(),
    promptId: v.id("prompts"),
  },
  returns: v.array(hydratedLineageResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) return [];
    const rows = await ctx.db
      .query("generationLineage")
      .withIndex("by_targetPrompt", (q) => q.eq("targetPromptId", args.promptId))
      .collect();
    const visible = rows.filter((row) =>
      canActorAccessOwnerUserId(ownerUserId, row.ownerUserId),
    );
    return hydrateLineageRows(ctx, visible);
  },
});

export const getDownstreamForAsset = query({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
  },
  returns: v.array(hydratedLineageResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) return [];
    const rows = await ctx.db
      .query("generationLineage")
      .withIndex("by_sourceAsset", (q) => q.eq("sourceAssetId", args.assetId))
      .collect();
    const visible = rows.filter((row) =>
      canActorAccessOwnerUserId(ownerUserId, row.ownerUserId),
    );
    return hydrateLineageRows(ctx, visible);
  },
});

export const getDownstreamForPrompt = query({
  args: {
    ownerUserId: v.string(),
    promptId: v.id("prompts"),
  },
  returns: v.array(hydratedLineageResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) return [];
    const rows = await ctx.db
      .query("generationLineage")
      .withIndex("by_sourcePrompt", (q) => q.eq("sourcePromptId", args.promptId))
      .collect();
    const visible = rows.filter((row) =>
      canActorAccessOwnerUserId(ownerUserId, row.ownerUserId),
    );
    return hydrateLineageRows(ctx, visible);
  },
});

export const deleteLineageForPrompt = internalMutation({
  args: { promptId: v.id("prompts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const asTarget = await ctx.db
      .query("generationLineage")
      .withIndex("by_targetPrompt", (q) => q.eq("targetPromptId", args.promptId))
      .collect();
    const asSource = await ctx.db
      .query("generationLineage")
      .withIndex("by_sourcePrompt", (q) => q.eq("sourcePromptId", args.promptId))
      .collect();
    for (const row of [...asTarget, ...asSource]) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});

export const deleteLineageForAsset = internalMutation({
  args: { assetId: v.id("assets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const asTarget = await ctx.db
      .query("generationLineage")
      .withIndex("by_targetAsset", (q) => q.eq("targetAssetId", args.assetId))
      .collect();
    const asSource = await ctx.db
      .query("generationLineage")
      .withIndex("by_sourceAsset", (q) => q.eq("sourceAssetId", args.assetId))
      .collect();
    for (const row of [...asTarget, ...asSource]) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});
