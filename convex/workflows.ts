import { v, ConvexError } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import {
  generationTypeValidator,
  modelProviderValidator,
  optionalPillarValidator,
  pillarValidator,
  promptSectionsValidator,
  promptTypeValidator,
  workflowTypeValidator,
} from "./validators";

// A workflow is an ordered container of steps. Each step is a prompt
// (extended with `workflowId` + `workflowStepOrder`) plus the assets linked
// to that prompt via `promptId`. Steps stay normal grid citizens — the
// workflow is purely an organizing layer on top.

const stepMediaValidator = v.object({
  id: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  contentType: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});

const workflowStepValidator = v.object({
  promptId: v.id("prompts"),
  stepOrder: v.number(),
  stepLabel: v.optional(v.string()),
  promptText: v.string(),
  promptSections: promptSectionsValidator,
  promptType: promptTypeValidator,
  modelName: v.optional(v.string()),
  modelProvider: modelProviderValidator,
  tagNames: v.array(v.string()),
  media: v.array(stepMediaValidator),
});

const workflowCardValidator = v.object({
  _id: v.id("workflows"),
  title: v.string(),
  description: v.optional(v.string()),
  pillar: optionalPillarValidator,
  tagNames: v.array(v.string()),
  stepCount: v.number(),
  isPublic: v.optional(v.boolean()),
  isFeatured: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
  previewImages: v.array(stepMediaValidator),
});

const resolveTagNames = async (
  ctx: QueryCtx,
  tagIds: Id<"tags">[],
): Promise<string[]> => {
  const names: string[] = [];
  for (const tagId of tagIds) {
    const tag = await ctx.db.get(tagId);
    if (tag) names.push(tag.name);
  }
  return names;
};

// Returns the workflow's prompt steps ordered by step index, each paired with
// its linked assets resolved to playable/thumbnail URLs.
const collectWorkflowSteps = async (
  ctx: QueryCtx,
  workflowId: Id<"workflows">,
) => {
  const prompts = await ctx.db
    .query("prompts")
    .withIndex("by_workflow_stepOrder", (q) => q.eq("workflowId", workflowId))
    .order("asc")
    .collect();

  const steps = [];
  for (const prompt of prompts) {
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_prompt_createdAt", (q) =>
        q.eq("promptId", prompt._id).gte("createdAt", 0),
      )
      .collect();
    assets.sort((a, b) => a.createdAt - b.createdAt);

    const media = [];
    for (const asset of assets) {
      media.push({
        id: asset._id,
        kind: asset.kind,
        url: await resolveAssetUrl(ctx, asset),
        thumbUrl: await resolveAssetThumbUrl(ctx, asset),
        contentType: asset.contentType,
        width: asset.width,
        height: asset.height,
      });
    }

    steps.push({
      promptId: prompt._id,
      stepOrder: prompt.workflowStepOrder ?? 0,
      stepLabel: prompt.workflowStepLabel,
      promptText: prompt.text,
      promptSections: prompt.promptSections,
      promptType: prompt.promptType,
      modelName: prompt.modelName,
      modelProvider: prompt.modelProvider,
      tagNames: await resolveTagNames(ctx, prompt.tagIds),
      media,
    });
  }
  return steps;
};

const collectWorkflowPreviewMedia = async (
  ctx: QueryCtx,
  workflowId: Id<"workflows">,
  previewLimit: number,
) => {
  if (previewLimit <= 0) {
    return [];
  }

  const prompts = await ctx.db
    .query("prompts")
    .withIndex("by_workflow_stepOrder", (q) => q.eq("workflowId", workflowId))
    .order("asc")
    .take(Math.max(previewLimit, 1));

  const media = [];
  for (const prompt of prompts) {
    const remaining = previewLimit - media.length;
    if (remaining <= 0) break;

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_prompt_createdAt", (q) =>
        q.eq("promptId", prompt._id).gte("createdAt", 0),
      )
      .order("asc")
      .take(remaining);

    for (const asset of assets) {
      const [url, thumbUrl] = await Promise.all([
        resolveAssetUrl(ctx, asset),
        resolveAssetThumbUrl(ctx, asset),
      ]);
      media.push({
        id: asset._id,
        kind: asset.kind,
        url,
        thumbUrl,
        contentType: asset.contentType,
        width: asset.width,
        height: asset.height,
      });
    }
  }
  return media;
};

export const listWorkflows = query({
  args: {
    ownerUserId: v.string(),
    pillar: optionalPillarValidator,
    scope: v.optional(v.union(v.literal("mine"), v.literal("public"))),
    limit: v.optional(v.number()),
    previewLimit: v.optional(v.number()),
  },
  returns: v.array(workflowCardValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const limit = Math.min(args.limit ?? 100, 200);
    const previewLimit = Math.min(Math.max(args.previewLimit ?? 8, 1), 24);
    const scope = args.scope ?? "mine";

    let workflows: Doc<"workflows">[] = [];
    if (scope === "public") {
      workflows = await ctx.db
        .query("workflows")
        .withIndex("by_isPublic_createdAt", (q) => q.eq("isPublic", true))
        .order("desc")
        .take(limit);
    } else {
      for (const owner of resolveUserIdCandidates(ownerUserId)) {
        const rows = args.pillar
          ? await ctx.db
              .query("workflows")
              .withIndex("by_owner_pillar_createdAt", (q) =>
                q.eq("ownerUserId", owner).eq("pillar", args.pillar),
              )
              .order("desc")
              .take(limit)
          : await ctx.db
              .query("workflows")
              .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", owner))
              .order("desc")
              .take(limit);
        workflows.push(...rows);
      }
    }

    const seen = new Set<string>();
    const deduped = workflows
      .filter((w) => {
        if (seen.has(w._id)) return false;
        seen.add(w._id);
        return true;
      })
      .filter((w) => !args.pillar || w.pillar === args.pillar)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);

    const cards = [];
    for (const workflow of deduped) {
      cards.push({
        _id: workflow._id,
        title: workflow.title,
        description: workflow.description,
        pillar: workflow.pillar,
        tagNames: await resolveTagNames(ctx, workflow.tagIds),
        stepCount: workflow.stepCount,
        isPublic: workflow.isPublic,
        isFeatured: workflow.isFeatured,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        previewImages: await collectWorkflowPreviewMedia(
          ctx,
          workflow._id,
          previewLimit,
        ),
      });
    }
    return cards;
  },
});

export const getWorkflow = query({
  args: {
    id: v.id("workflows"),
    ownerUserId: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("workflows"),
      ownerUserId: v.optional(v.string()),
      title: v.string(),
      description: v.optional(v.string()),
      agentInstructions: v.optional(v.string()),
      pillar: optionalPillarValidator,
      tagNames: v.array(v.string()),
      stepCount: v.number(),
      isPublic: v.optional(v.boolean()),
      isFeatured: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
      steps: v.array(workflowStepValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const workflow = await ctx.db.get(args.id);
    if (!workflow) return null;

    const isOwner =
      Boolean(args.ownerUserId) &&
      canActorAccessOwnerUserId(args.ownerUserId!, workflow.ownerUserId);
    if (!isOwner && !workflow.isPublic) {
      return null;
    }

    return {
      _id: workflow._id,
      ownerUserId: workflow.ownerUserId,
      title: workflow.title,
      description: workflow.description,
      agentInstructions: workflow.agentInstructions,
      pillar: workflow.pillar,
      tagNames: await resolveTagNames(ctx, workflow.tagIds),
      stepCount: workflow.stepCount,
      isPublic: workflow.isPublic,
      isFeatured: workflow.isFeatured,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
      steps: await collectWorkflowSteps(ctx, workflow._id),
    };
  },
});

export const createWorkflow = mutation({
  args: {
    ownerUserId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    agentInstructions: v.optional(v.string()),
    pillar: optionalPillarValidator,
    tagIds: v.optional(v.array(v.id("tags"))),
    ingestKey: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    isFeatured: v.optional(v.boolean()),
  },
  returns: v.object({ workflowId: v.id("workflows"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const title = args.title.trim();
    if (!title) {
      throw new ConvexError("Workflow title is required.");
    }

    if (args.ingestKey) {
      const existing = await ctx.db
        .query("workflows")
        .withIndex("by_owner_ingestKey", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("ingestKey", args.ingestKey),
        )
        .unique();
      if (existing) {
        return { workflowId: existing._id, created: false };
      }
    }

    const now = Date.now();
    const workflowId = await ctx.db.insert("workflows", {
      ownerUserId,
      title,
      description: args.description?.trim() || undefined,
      agentInstructions: args.agentInstructions?.trim() || undefined,
      pillar: args.pillar,
      tagIds: args.tagIds ?? [],
      ingestKey: args.ingestKey,
      stepCount: 0,
      isPublic: args.isPublic,
      isFeatured: args.isFeatured,
      createdAt: now,
      updatedAt: now,
    });
    return { workflowId, created: true };
  },
});

export const updateWorkflow = mutation({
  args: {
    ownerUserId: v.string(),
    id: v.id("workflows"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    agentInstructions: v.optional(v.string()),
    pillar: optionalPillarValidator,
    isPublic: v.optional(v.boolean()),
    isFeatured: v.optional(v.boolean()),
    coverAssetId: v.optional(v.id("assets")),
  },
  returns: v.id("workflows"),
  handler: async (ctx, args) => {
    const workflow = await ctx.db.get(args.id);
    if (!workflow) {
      throw new ConvexError("Workflow not found.");
    }
    if (!canActorAccessOwnerUserId(args.ownerUserId, workflow.ownerUserId)) {
      throw new ConvexError("Workflow does not belong to this user.");
    }

    const patch: Partial<Omit<Doc<"workflows">, "_id" | "_creationTime">> = {
      updatedAt: Date.now(),
    };
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.agentInstructions !== undefined) {
      patch.agentInstructions = args.agentInstructions.trim() || undefined;
    }
    if (args.pillar !== undefined) patch.pillar = args.pillar;
    if (args.isPublic !== undefined) patch.isPublic = args.isPublic;
    if (args.isFeatured !== undefined) patch.isFeatured = args.isFeatured;
    if (args.coverAssetId !== undefined) patch.coverAssetId = args.coverAssetId;

    await ctx.db.patch(args.id, patch);
    return args.id;
  },
});

export const deleteWorkflow = mutation({
  args: { ownerUserId: v.string(), id: v.id("workflows") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workflow = await ctx.db.get(args.id);
    if (!workflow) return null;
    if (!canActorAccessOwnerUserId(args.ownerUserId, workflow.ownerUserId)) {
      throw new ConvexError("Workflow does not belong to this user.");
    }

    // Unlink step prompts — prompts/assets survive as standalone grid entries.
    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_workflow_stepOrder", (q) => q.eq("workflowId", args.id))
      .collect();
    for (const prompt of prompts) {
      await ctx.db.patch(prompt._id, {
        workflowId: undefined,
        workflowStepOrder: undefined,
        workflowStepLabel: undefined,
      });
    }

    await ctx.db.delete(args.id);
    return null;
  },
});

// Links an already-ingested prompt to a workflow as a step. Idempotent —
// re-running an ingest re-patches the same prompt without side effects.
export const linkPromptToWorkflow = internalMutation({
  args: {
    promptId: v.id("prompts"),
    workflowId: v.id("workflows"),
    workflowStepOrder: v.number(),
    workflowStepLabel: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.promptId, {
      workflowId: args.workflowId,
      workflowStepOrder: args.workflowStepOrder,
      workflowStepLabel: args.workflowStepLabel,
    });
    return null;
  },
});

// Recomputes the denormalized stepCount and pins a cover asset from the
// first available step media when one is not already set.
export const finalizeWorkflow = internalMutation({
  args: {
    workflowId: v.id("workflows"),
    coverAssetId: v.optional(v.id("assets")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workflow = await ctx.db.get(args.workflowId);
    if (!workflow) return null;

    const steps = await ctx.db
      .query("prompts")
      .withIndex("by_workflow_stepOrder", (q) =>
        q.eq("workflowId", args.workflowId),
      )
      .collect();

    await ctx.db.patch(args.workflowId, {
      stepCount: steps.length,
      coverAssetId: workflow.coverAssetId ?? args.coverAssetId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

const stepFileValidator = v.object({
  base64: v.string(),
  fileName: v.optional(v.string()),
  contentType: v.optional(v.string()),
});

// Single-call workflow ingest: creates the workflow row, then ingests each
// step's prompt + media through the canonical `ingest:ingestFromApi` path so
// steps inherit R2 storage, thumbnails, tagging and semantic indexing.
export const ingestWorkflowFromApi = action({
  args: {
    ownerUserId: v.string(),
    ingestKey: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    agentInstructions: v.optional(v.string()),
    pillar: pillarValidator,
    tagNames: v.optional(v.array(v.string())),
    isPublic: v.optional(v.boolean()),
    isFeatured: v.optional(v.boolean()),
    steps: v.array(
      v.object({
        stepLabel: v.optional(v.string()),
        promptText: v.optional(v.string()),
        promptSections: promptSectionsValidator,
        promptType: promptTypeValidator,
        generationType: generationTypeValidator,
        workflowType: workflowTypeValidator,
        modelName: v.optional(v.string()),
        modelProvider: modelProviderValidator,
        tagNames: v.optional(v.array(v.string())),
        promptIngestKey: v.optional(v.string()),
        allowPromptOnly: v.optional(v.boolean()),
        media: v.optional(
          v.array(
            v.object({
              ingestKey: v.optional(v.string()),
              url: v.optional(v.string()),
              file: v.optional(stepFileValidator),
            }),
          ),
        ),
      }),
    ),
  },
  returns: v.object({
    workflowId: v.id("workflows"),
    stepCount: v.number(),
  }),
  handler: async (ctx, args): Promise<{ workflowId: Id<"workflows">; stepCount: number }> => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    if (args.steps.length === 0) {
      throw new ConvexError("A workflow needs at least one step.");
    }

    const workflowTagIds = args.tagNames?.length
      ? ((await ctx.runMutation(api.tags.getOrCreateTagsWithMetadata, {
          tags: args.tagNames.map((name) => ({
            name,
            category: undefined,
            pillar: args.pillar,
            source: "agent" as const,
          })),
        })) as Id<"tags">[])
      : [];

    const { workflowId } = (await ctx.runMutation(api.workflows.createWorkflow, {
      ownerUserId,
      title: args.title,
      description: args.description,
      agentInstructions: args.agentInstructions,
      pillar: args.pillar,
      tagIds: workflowTagIds,
      ingestKey: args.ingestKey,
      isPublic: args.isPublic,
      isFeatured: args.isFeatured,
    })) as { workflowId: Id<"workflows">; created: boolean };

    let coverAssetId: Id<"assets"> | undefined;

    for (let stepIndex = 0; stepIndex < args.steps.length; stepIndex++) {
      const step = args.steps[stepIndex]!;
      const stepKeyBase =
        step.promptIngestKey ??
        (args.ingestKey ? `${args.ingestKey}:step${stepIndex}` : undefined);
      const media = step.media ?? [];

      let stepPromptId: Id<"prompts"> | undefined;

      if (media.length === 0) {
        const result = (await ctx.runAction(api.ingest.ingestFromApi, {
          ownerUserId,
          promptText: step.promptText,
          promptSections: step.promptSections,
          allowPromptOnly: step.allowPromptOnly,
          pillar: args.pillar,
          promptType: step.promptType,
          generationType: step.generationType,
          workflowType: step.workflowType,
          modelName: step.modelName,
          modelProvider: step.modelProvider,
          tagNames: step.tagNames,
          ingestKey: stepKeyBase,
          promptIngestKey: stepKeyBase,
          ingestSource: "agent" as const,
        })) as { promptId?: Id<"prompts">; assetId?: Id<"assets"> };
        stepPromptId = result.promptId;
      } else {
        for (let mediaIndex = 0; mediaIndex < media.length; mediaIndex++) {
          const item = media[mediaIndex]!;
          const result = (await ctx.runAction(api.ingest.ingestFromApi, {
            ownerUserId,
            promptText: step.promptText,
            promptSections: step.promptSections,
            url: item.url,
            file: item.file,
            pillar: args.pillar,
            promptType: step.promptType,
            generationType: step.generationType,
            workflowType: step.workflowType,
            modelName: step.modelName,
            modelProvider: step.modelProvider,
            tagNames: step.tagNames,
            ingestKey:
              item.ingestKey ??
              (stepKeyBase ? `${stepKeyBase}:m${mediaIndex}` : undefined),
            promptIngestKey: stepKeyBase,
            assetRole: "workflow_asset" as const,
            ingestSource: "agent" as const,
          })) as { promptId?: Id<"prompts">; assetId?: Id<"assets"> };
          if (!stepPromptId) stepPromptId = result.promptId;
          if (!coverAssetId && result.assetId) coverAssetId = result.assetId;
        }
      }

      if (stepPromptId) {
        await ctx.runMutation(internal.workflows.linkPromptToWorkflow, {
          promptId: stepPromptId,
          workflowId,
          workflowStepOrder: stepIndex,
          workflowStepLabel: step.stepLabel,
        });
      }
    }

    await ctx.runMutation(internal.workflows.finalizeWorkflow, {
      workflowId,
      coverAssetId,
    });

    return { workflowId, stepCount: args.steps.length };
  },
});
