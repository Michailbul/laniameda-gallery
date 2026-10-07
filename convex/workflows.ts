import { v, ConvexError } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { canonicalTagKey, normalizeTagName } from "./helpers";
import { ensureFolderOwnership } from "./folderHelpers";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import {
  generationTypeValidator,
  modelProviderValidator,
  optionalPillarValidator,
  promptSectionsValidator,
  promptTypeValidator,
  workflowTypeValidator,
} from "./validators";
import { ownerAction, ownerMutation, ownerQuery, signedOwnerAction } from "./actor";

// A skill — stored in the `workflows` table, which predates the name — is an
// ordered container of steps plus an optional markdown body. Users and agents
// both call it a skill; the table and the `workflow:` id prefix stay for
// compatibility.
//
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
  /** Per-file caption — what THIS render is within the step ("start frame",
   *  "stand-in crop", "final cut"). Stored on `assets.description`. */
  description: v.optional(v.string()),
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

// Embeddings are written off the request path; a skill edit is searchable a
// moment later.
const reindexSkillRef = makeFunctionReference<"action">(
  "semanticIndex:reindexSkill",
);
const scheduleSkillReindex = async (
  ctx: Pick<MutationCtx, "scheduler">,
  workflowId: Id<"workflows">,
) => {
  await ctx.scheduler.runAfter(0, reindexSkillRef, { workflowId });
};

const skillCollectionValidator = v.object({
  _id: v.id("folders"),
  name: v.string(),
  parentFolderId: v.optional(v.id("folders")),
});

export const workflowCardValidator = v.object({
  _id: v.id("workflows"),
  title: v.string(),
  description: v.optional(v.string()),
  /** First words of the markdown body, for card excerpts. */
  excerpt: v.optional(v.string()),
  pillar: optionalPillarValidator,
  tagNames: v.array(v.string()),
  folderIds: v.array(v.id("folders")),
  modelNames: v.array(v.string()),
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

const listSkillFolderIds = async (
  ctx: QueryCtx,
  workflowId: Id<"workflows">,
): Promise<Id<"folders">[]> => {
  const links = await ctx.db
    .query("workflowFolders")
    .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
    .collect();
  return Array.from(new Set(links.map((link) => link.folderId)));
};

const listSkillModelNames = async (
  ctx: QueryCtx,
  workflowId: Id<"workflows">,
): Promise<string[]> => {
  const prompts = await ctx.db
    .query("prompts")
    .withIndex("by_workflow_stepOrder", (q) => q.eq("workflowId", workflowId))
    .collect();
  return Array.from(
    new Set(
      prompts
        .map((prompt) => prompt.modelName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  );
};

// Markdown flattened to a plain lead sentence or two for cards.
export const markdownExcerpt = (markdown: string | undefined, max = 220) => {
  if (!markdown) return undefined;
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+>]\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

// `![caption](asset:<id>)` (or `asset:<id>` anywhere) in a skill body.
export const parseBodyAssetIds = (body: string | undefined) =>
  Array.from(
    new Set(
      Array.from((body ?? "").matchAll(/asset:([a-z0-9]{20,40})/gi), (m) => m[1]!),
    ),
  ).slice(0, 60);

const skillMatchesTags = (tagNames: string[], required: string[]) => {
  if (required.length === 0) return true;
  const have = new Set(tagNames.map(canonicalTagKey));
  return required.every((tag) => have.has(canonicalTagKey(tag)));
};

// True when the skill carries any of the excluded tags. The Skills tab drops
// cinematography packs this way.
const skillHasExcludedTag = (tagNames: string[], excluded: string[]) => {
  if (excluded.length === 0) return false;
  const have = new Set(tagNames.map(canonicalTagKey));
  return excluded.some((tag) => have.has(canonicalTagKey(tag)));
};

const skillMatchesSearch = (
  workflow: Doc<"workflows">,
  tagNames: string[],
  search: string,
) => {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    workflow.title,
    workflow.description,
    workflow.body,
    workflow.agentInstructions,
    tagNames.join(" "),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return needle.split(/\s+/).every((word) => haystack.includes(word));
};

const buildSkillCard = async (
  ctx: QueryCtx,
  workflow: Doc<"workflows">,
  previewLimit: number,
  tagNames?: string[],
) => ({
  _id: workflow._id,
  title: workflow.title,
  description: workflow.description,
  excerpt: markdownExcerpt(workflow.body ?? workflow.agentInstructions),
  pillar: workflow.pillar,
  tagNames: tagNames ?? (await resolveTagNames(ctx, workflow.tagIds)),
  folderIds: await listSkillFolderIds(ctx, workflow._id),
  modelNames: await listSkillModelNames(ctx, workflow._id),
  stepCount: workflow.stepCount,
  isPublic: workflow.isPublic,
  isFeatured: workflow.isFeatured,
  createdAt: workflow.createdAt,
  updatedAt: workflow.updatedAt,
  previewImages: await collectWorkflowPreviewMedia(ctx, workflow._id, previewLimit),
});

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
        description: asset.description,
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
        description: asset.description,
      });
    }
  }
  return media;
};

export const listWorkflows = ownerQuery({
  args: {
    ownerUserId: v.string(),
    pillar: optionalPillarValidator,
    scope: v.optional(v.union(v.literal("mine"), v.literal("public"))),
    // Every tag must be on the skill (canonical match: case, "-", "_" fold).
    tagNames: v.optional(v.array(v.string())),
    // Skills carrying any of these tags are left out.
    excludeTagNames: v.optional(v.array(v.string())),
    // Only skills filed in this collection.
    folderId: v.optional(v.id("folders")),
    // Words that must all appear in the title, description, body or tags.
    search: v.optional(v.string()),
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
    if (args.folderId) {
      const links = await ctx.db
        .query("workflowFolders")
        .withIndex("by_folder_createdAt", (q) =>
          q.eq("folderId", args.folderId!).gte("createdAt", 0),
        )
        .collect();
      for (const link of links) {
        const workflow = await ctx.db.get(link.workflowId);
        if (!workflow) continue;
        const visible =
          scope === "public"
            ? workflow.isPublic === true
            : canActorAccessOwnerUserId(ownerUserId, workflow.ownerUserId);
        if (visible) workflows.push(workflow);
      }
    } else if (scope === "public") {
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
      .sort((a, b) => b.createdAt - a.createdAt);

    const requiredTags = (args.tagNames ?? []).filter((tag) => tag.trim());
    const excludedTags = (args.excludeTagNames ?? []).filter((tag) => tag.trim());
    const cards = [];
    for (const workflow of deduped) {
      if (cards.length >= limit) break;
      const tagNames = await resolveTagNames(ctx, workflow.tagIds);
      if (!skillMatchesTags(tagNames, requiredTags)) continue;
      if (skillHasExcludedTag(tagNames, excludedTags)) continue;
      if (args.search && !skillMatchesSearch(workflow, tagNames, args.search)) {
        continue;
      }
      cards.push(await buildSkillCard(ctx, workflow, previewLimit, tagNames));
    }
    return cards;
  },
});

export const getWorkflow = ownerQuery({
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
      body: v.optional(v.string()),
      // Media the body embeds as `asset:<id>`, resolved to URLs.
      bodyMedia: v.array(stepMediaValidator),
      pillar: optionalPillarValidator,
      tagNames: v.array(v.string()),
      collections: v.array(skillCollectionValidator),
      modelNames: v.array(v.string()),
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

    const collections = [];
    for (const folderId of await listSkillFolderIds(ctx, workflow._id)) {
      const folder = await ctx.db.get(folderId);
      if (folder) {
        collections.push({
          _id: folder._id,
          name: folder.name,
          parentFolderId: folder.parentFolderId,
        });
      }
    }

    const bodyMedia = [];
    for (const assetId of parseBodyAssetIds(workflow.body)) {
      const normalized = ctx.db.normalizeId("assets", assetId);
      const asset = normalized ? await ctx.db.get(normalized) : null;
      if (!asset) continue;
      if (
        !asset.isPublic &&
        !(isOwner && canActorAccessOwnerUserId(args.ownerUserId!, asset.ownerUserId))
      ) {
        continue;
      }
      bodyMedia.push({
        id: asset._id,
        kind: asset.kind,
        url: await resolveAssetUrl(ctx, asset),
        thumbUrl: await resolveAssetThumbUrl(ctx, asset),
        contentType: asset.contentType,
        width: asset.width,
        height: asset.height,
        description: asset.description,
      });
    }

    return {
      _id: workflow._id,
      ownerUserId: workflow.ownerUserId,
      title: workflow.title,
      description: workflow.description,
      agentInstructions: workflow.agentInstructions,
      body: workflow.body,
      bodyMedia,
      pillar: workflow.pillar,
      tagNames: await resolveTagNames(ctx, workflow.tagIds),
      collections,
      modelNames: await listSkillModelNames(ctx, workflow._id),
      stepCount: workflow.stepCount,
      isPublic: workflow.isPublic,
      isFeatured: workflow.isFeatured,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
      steps: await collectWorkflowSteps(ctx, workflow._id),
    };
  },
});

const findSkillByIngestKey = async (
  ctx: Pick<QueryCtx, "db">, ownerUserId: string, ingestKey: string,
) => {
  for (const owner of resolveUserIdCandidates(ownerUserId)) {
    const row = await ctx.db.query("workflows").withIndex("by_owner_ingestKey", (q) =>
      q.eq("ownerUserId", owner).eq("ingestKey", ingestKey),
    ).unique();
    if (row) return row;
  }
  return null;
};

export const getSkillCreation = internalQuery({
  args: { ownerUserId: v.string(), ingestKey: v.string() },
  returns: v.union(v.null(), v.object({
    workflowId: v.id("workflows"), fingerprint: v.optional(v.string()), complete: v.boolean(), stepCount: v.number(),
  })),
  handler: async (ctx, args) => {
    const row = await findSkillByIngestKey(ctx, args.ownerUserId, args.ingestKey);
    return row ? { workflowId: row._id, fingerprint: row.creationFingerprint, complete: row.creationComplete === true, stepCount: row.stepCount } : null;
  },
});

export const createWorkflow = ownerMutation({
  args: {
    ownerUserId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    agentInstructions: v.optional(v.string()),
    body: v.optional(v.string()),
    pillar: optionalPillarValidator,
    tagIds: v.optional(v.array(v.id("tags"))),
    ingestKey: v.optional(v.string()),
    creationFingerprint: v.optional(v.string()),
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
      const existing = await findSkillByIngestKey(ctx, ownerUserId, args.ingestKey);
      if (existing) {
        if (args.creationFingerprint && existing.creationFingerprint !== args.creationFingerprint) {
          throw new ConvexError("This ingestKey already belongs to another Skill creation. Use a new key or update_skill.");
        }
        // A re-run of the same ingest refreshes the document, not the steps.
        const body = args.body?.trim();
        if (!args.creationFingerprint && body && body !== existing.body) {
          await ctx.db.patch(existing._id, { body, updatedAt: Date.now() });
        }
        return { workflowId: existing._id, created: false };
      }
    }

    const now = Date.now();
    const workflowId = await ctx.db.insert("workflows", {
      ownerUserId,
      title,
      description: args.description?.trim() || undefined,
      agentInstructions: args.agentInstructions?.trim() || undefined,
      body: args.body?.trim() || undefined,
      pillar: args.pillar,
      tagIds: args.tagIds ?? [],
      ingestKey: args.ingestKey,
      creationFingerprint: args.creationFingerprint,
      creationComplete: args.creationFingerprint ? false : undefined,
      stepCount: 0,
      isPublic: args.isPublic,
      isFeatured: args.isFeatured,
      createdAt: now,
      updatedAt: now,
    });
    return { workflowId, created: true };
  },
});

export const deleteWorkflow = ownerMutation({
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
      // The grid hides `workflow_asset` media because its workflow is the only
      // place it belongs. Once that workflow is gone the role would strand the
      // asset in no view at all, so clear it and let the media back into the
      // grid — which is what "survive as standalone grid entries" means.
      const stepAssets = await ctx.db
        .query("assets")
        .withIndex("by_prompt_createdAt", (q) =>
          q.eq("promptId", prompt._id).gte("createdAt", 0),
        )
        .collect();
      for (const asset of stepAssets) {
        if (asset.assetRole === "workflow_asset") {
          await ctx.db.patch(asset._id, { assetRole: undefined });
        }
      }
    }

    const links = await ctx.db
      .query("workflowFolders")
      .withIndex("by_workflow", (q) => q.eq("workflowId", args.id))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }

    await ctx.db.delete(args.id);
    // The reindex finds the row gone and drops its search document.
    await scheduleSkillReindex(ctx, args.id);
    return null;
  },
});

const resolveOrCreateTagIds = async (
  ctx: MutationCtx,
  names: string[],
  pillar: Doc<"workflows">["pillar"],
): Promise<Id<"tags">[]> => {
  const ids: Id<"tags">[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/^#+/, "");
    const canonical = canonicalTagKey(name);
    if (!canonical) continue;
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_canonicalKey", (q) => q.eq("canonicalKey", canonical))
      .first();
    if (existing) {
      if (!ids.includes(existing._id)) ids.push(existing._id);
      continue;
    }
    ids.push(
      await ctx.db.insert("tags", {
        name,
        normalized: normalizeTagName(name),
        canonicalKey: canonical,
        usageCount: 0,
        pillar,
        source: "user",
      }),
    );
  }
  return ids;
};

const requireOwnedSkill = async (
  ctx: MutationCtx,
  ownerUserId: string,
  id: Id<"workflows">,
) => {
  const workflow = await ctx.db.get(id);
  if (!workflow) {
    throw new ConvexError("Skill not found.");
  }
  if (!canActorAccessOwnerUserId(ownerUserId, workflow.ownerUserId)) {
    throw new ConvexError("Skill does not belong to this user.");
  }
  return workflow;
};

// Edit a skill's words and tags. Omitted fields stay; an empty string clears
// an optional field. `tagNames` replaces the whole tag set; `addTagNames` /
// `removeTagNames` adjust it.
export const updateSkill = ownerMutation({
  args: {
    ownerUserId: v.string(),
    id: v.id("workflows"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    body: v.optional(v.string()),
    agentInstructions: v.optional(v.string()),
    tagNames: v.optional(v.array(v.string())),
    addTagNames: v.optional(v.array(v.string())),
    removeTagNames: v.optional(v.array(v.string())),
  },
  returns: v.object({ id: v.id("workflows"), tagNames: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const workflow = await requireOwnedSkill(ctx, args.ownerUserId, args.id);
    const patch: Partial<Doc<"workflows">> = {};

    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new ConvexError("A skill needs a title.");
      patch.title = title;
    }
    if (args.description !== undefined) {
      patch.description = args.description.trim() || undefined;
    }
    if (args.body !== undefined) {
      patch.body = args.body.trim() || undefined;
    }
    if (args.agentInstructions !== undefined) {
      patch.agentInstructions = args.agentInstructions.trim() || undefined;
    }

    let tagIds = workflow.tagIds;
    if (args.tagNames !== undefined) {
      tagIds = await resolveOrCreateTagIds(ctx, args.tagNames, workflow.pillar);
    }
    if (args.addTagNames?.length) {
      const added = await resolveOrCreateTagIds(ctx, args.addTagNames, workflow.pillar);
      tagIds = [...tagIds, ...added.filter((id) => !tagIds.includes(id))];
    }
    if (args.removeTagNames?.length) {
      const drop = new Set(args.removeTagNames.map(canonicalTagKey));
      const kept: Id<"tags">[] = [];
      for (const tagId of tagIds) {
        const tag = await ctx.db.get(tagId);
        if (tag && !drop.has(canonicalTagKey(tag.name))) kept.push(tagId);
      }
      tagIds = kept;
    }
    if (tagIds !== workflow.tagIds) patch.tagIds = tagIds;

    await ctx.db.patch(args.id, { ...patch, updatedAt: Date.now() });
    await scheduleSkillReindex(ctx, args.id);
    return { id: args.id, tagNames: await resolveTagNames(ctx, tagIds) };
  },
});

// File a skill into a collection. Idempotent.
export const addSkillToCollection = ownerMutation({
  args: {
    ownerUserId: v.string(),
    id: v.id("workflows"),
    folderId: v.id("folders"),
  },
  returns: v.object({ added: v.boolean() }),
  handler: async (ctx, args) => {
    const workflow = await requireOwnedSkill(ctx, args.ownerUserId, args.id);
    await ensureFolderOwnership(ctx, args.ownerUserId, args.folderId);
    const existing = await ctx.db
      .query("workflowFolders")
      .withIndex("by_workflow_folder", (q) =>
        q.eq("workflowId", args.id).eq("folderId", args.folderId),
      )
      .first();
    if (existing) return { added: false };
    await ctx.db.insert("workflowFolders", {
      ownerUserId: workflow.ownerUserId ?? args.ownerUserId,
      workflowId: args.id,
      folderId: args.folderId,
      createdAt: Date.now(),
    });
    return { added: true };
  },
});

// Take a skill out of a collection. The skill itself stays.
export const removeSkillFromCollection = ownerMutation({
  args: {
    ownerUserId: v.string(),
    id: v.id("workflows"),
    folderId: v.id("folders"),
  },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    await requireOwnedSkill(ctx, args.ownerUserId, args.id);
    const links = await ctx.db
      .query("workflowFolders")
      .withIndex("by_workflow_folder", (q) =>
        q.eq("workflowId", args.id).eq("folderId", args.folderId),
      )
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
    return { removed: links.length > 0 };
  },
});

// Hydrates ranked search hits into cards, keeping rank order and applying the
// same tag / collection filters as listWorkflows.
export const listSkillCardsByIds = internalQuery({
  args: {
    ownerUserId: v.string(),
    ids: v.array(v.id("workflows")),
    tagNames: v.optional(v.array(v.string())),
    excludeTagNames: v.optional(v.array(v.string())),
    folderId: v.optional(v.id("folders")),
    previewLimit: v.optional(v.number()),
  },
  returns: v.array(workflowCardValidator),
  handler: async (ctx, args) => {
    const previewLimit = Math.min(Math.max(args.previewLimit ?? 6, 1), 24);
    const requiredTags = (args.tagNames ?? []).filter((tag) => tag.trim());
    const excludedTags = (args.excludeTagNames ?? []).filter((tag) => tag.trim());
    const cards = [];
    for (const id of args.ids) {
      const workflow = await ctx.db.get(id);
      if (!workflow) continue;
      if (!canActorAccessOwnerUserId(args.ownerUserId, workflow.ownerUserId)) continue;
      const tagNames = await resolveTagNames(ctx, workflow.tagIds);
      if (!skillMatchesTags(tagNames, requiredTags)) continue;
      if (skillHasExcludedTag(tagNames, excludedTags)) continue;
      if (args.folderId) {
        const link = await ctx.db
          .query("workflowFolders")
          .withIndex("by_workflow_folder", (q) =>
            q.eq("workflowId", id).eq("folderId", args.folderId!),
          )
          .first();
        if (!link) continue;
      }
      cards.push(await buildSkillCard(ctx, workflow, previewLimit, tagNames));
    }
    return cards;
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
      ...(workflow.creationFingerprint ? { creationComplete: true } : {}),
      coverAssetId: workflow.coverAssetId ?? args.coverAssetId,
      updatedAt: Date.now(),
    });
    await scheduleSkillReindex(ctx, args.workflowId);
    return null;
  },
});

// One-time backfill: asset packs and workflows were two names for the same
// idea — a group of media that shares one prompt — and only workflows have a
// browse surface now. Each pack becomes a single-step workflow whose step is
// the prompt its assets already share.
//
// Deliberately does NOT stamp `assetRole: "workflow_asset"` on the converted
// assets. Those images have always been ordinary grid content; giving them the
// workflow role would yank them out of the gallery, which is a different
// decision than "give this pack a workflows-view card". The pack rows are left
// in place too — nothing reads them anymore, and keeping them makes this
// reversible.
export const backfillPacksAsWorkflows = ownerMutation({
  args: {
    ownerUserId: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    packsScanned: v.number(),
    converted: v.number(),
    skippedAlreadyWorkflow: v.number(),
    skippedNoPrompt: v.number(),
    titles: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const dryRun = args.dryRun === true;

    const packs: Doc<"assetPacks">[] = [];
    for (const owner of resolveUserIdCandidates(ownerUserId)) {
      const rows = await ctx.db
        .query("assetPacks")
        .withIndex("by_owner_createdAt", (q) =>
          q.eq("ownerUserId", owner).gte("createdAt", 0),
        )
        .collect();
      packs.push(...rows);
    }

    let converted = 0;
    let skippedAlreadyWorkflow = 0;
    let skippedNoPrompt = 0;
    const titles: string[] = [];

    for (const pack of packs) {
      const members = await ctx.db
        .query("assets")
        .withIndex("by_assetPack_packSlotIndex", (q) =>
          q.eq("assetPackId", pack._id),
        )
        .collect();

      // A pack exists because its members share a prompt; that prompt is the
      // step. If members disagree, the earliest-created one wins.
      const promptIds = members
        .map((asset) => asset.promptId)
        .filter((promptId): promptId is Id<"prompts"> => Boolean(promptId));
      if (promptIds.length === 0) {
        skippedNoPrompt += 1;
        continue;
      }
      const prompt = await ctx.db.get(promptIds[0]!);
      if (!prompt) {
        skippedNoPrompt += 1;
        continue;
      }
      // Packs that a workflow ingest created as a side effect of one step
      // sharing a promptIngestKey across several media. Their parent workflow
      // already represents them.
      if (prompt.workflowId) {
        skippedAlreadyWorkflow += 1;
        continue;
      }

      if (dryRun) {
        converted += 1;
        titles.push(pack.title);
        continue;
      }

      const now = Date.now();
      const workflowId = await ctx.db.insert("workflows", {
        ownerUserId: pack.ownerUserId,
        title: pack.title,
        description: pack.description,
        pillar: pack.pillar,
        tagIds: pack.tagIds,
        ingestKey: pack.ingestKey
          ? `${pack.ingestKey}:as-workflow`
          : undefined,
        coverAssetId: pack.coverAssetId,
        stepCount: 1,
        isPublic: pack.isPublic,
        isFeatured: pack.isFeatured,
        createdAt: pack.createdAt,
        updatedAt: now,
      });

      await ctx.db.patch(prompt._id, {
        workflowId,
        workflowStepOrder: 0,
        workflowStepLabel: pack.modelName
          ? `${pack.modelName} — ${members.length} ${members.length === 1 ? "output" : "outputs"}`
          : `${members.length} ${members.length === 1 ? "output" : "outputs"}`,
      });

      converted += 1;
      titles.push(pack.title);
    }

    return {
      packsScanned: packs.length,
      converted,
      skippedAlreadyWorkflow,
      skippedNoPrompt,
      titles,
    };
  },
});

const stepFileValidator = v.object({
  base64: v.string(),
  fileName: v.optional(v.string()),
  contentType: v.optional(v.string()),
});

// One file inside a step. Three ways to hand over the bytes — a remote `url`,
// an inline base64 `file` (images, capped by the Convex argument size), or an
// `r2Key` the caller already uploaded (the only route for video, whose poster
// rides along as `posterFile`). `description` is the per-file caption.
const stepMediaInputValidator = v.object({
  ingestKey: v.optional(v.string()),
  url: v.optional(v.string()),
  file: v.optional(stepFileValidator),
  description: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  agentDescription: v.optional(v.string()),
  r2Key: v.optional(v.string()),
  r2Bucket: v.optional(v.string()),
  mediaContentHash: v.optional(v.string()),
  mediaContentType: v.optional(v.string()),
  mediaSize: v.optional(v.number()),
  mediaWidth: v.optional(v.number()),
  mediaHeight: v.optional(v.number()),
  mediaFileName: v.optional(v.string()),
  posterFile: v.optional(
    v.object({
      base64: v.string(),
      contentType: v.optional(v.string()),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
      size: v.optional(v.number()),
    }),
  ),
});

// Single-call workflow ingest: creates the workflow row, then ingests each
// step's prompt + media through the canonical `ingest:ingestFromApi` path so
// steps inherit R2 storage, thumbnails, tagging and semantic indexing.
const skillIngestArgs = {
    ownerUserId: v.string(),
    ingestKey: v.optional(v.string()),
    creationFingerprint: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    agentInstructions: v.optional(v.string()),
    // The skill as a markdown document; `![caption](asset:<id>)` embeds an image.
    body: v.optional(v.string()),
    pillar: optionalPillarValidator,
    tagNames: v.optional(v.array(v.string())),
    // Collections to file the skill into.
    folderIds: v.optional(v.array(v.id("folders"))),
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
        media: v.optional(v.array(stepMediaInputValidator)),
      }),
    ),
};

export const ingestWorkflowFromApi = ownerAction({
  args: skillIngestArgs,
  returns: v.object({
    workflowId: v.id("workflows"),
    stepCount: v.number(),
    created: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{ workflowId: Id<"workflows">; stepCount: number; created: boolean }> => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    if (args.steps.length === 0 && !args.body?.trim() && !args.agentInstructions?.trim()) {
      throw new ConvexError("A Skill needs a markdown body, how-to instructions or at least one step.");
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

    const { workflowId, created } = (await ctx.runMutation(api.workflows.createWorkflow, {
      ownerUserId,
      title: args.title,
      description: args.description,
      agentInstructions: args.agentInstructions,
      body: args.body,
      pillar: args.pillar,
      tagIds: workflowTagIds,
      ingestKey: args.ingestKey,
      creationFingerprint: args.creationFingerprint,
      isPublic: args.isPublic,
      isFeatured: args.isFeatured,
    })) as { workflowId: Id<"workflows">; created: boolean };

    let failedStep = "steps";
    try {
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
              description: item.description,
              sourceUrl: item.sourceUrl,
              agentDescription: item.agentDescription,
              r2Key: item.r2Key,
              r2Bucket: item.r2Bucket,
              mediaContentHash: item.mediaContentHash,
              mediaContentType: item.mediaContentType,
              mediaSize: item.mediaSize,
              mediaWidth: item.mediaWidth,
              mediaHeight: item.mediaHeight,
              mediaFileName: item.mediaFileName,
              posterFile: item.posterFile,
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

      failedStep = "collections";
      for (const folderId of args.folderIds ?? []) {
        await ctx.runMutation(api.workflows.addSkillToCollection, {
          ownerUserId,
          id: workflowId,
          folderId,
        });
      }

      failedStep = "finalize";
      await ctx.runMutation(internal.workflows.finalizeWorkflow, {
        workflowId,
        coverAssetId,
      });

      return { workflowId, stepCount: args.steps.length, created };
    } catch (error) {
      throw new ConvexError({ message: error instanceof Error ? error.message : "Skill creation failed.", failedStep, workflowId });
    }
  },
});

// Public agent creation uses a stable key and a fingerprint of the original
// request. Completed retries return the existing Skill without replaying media
// or replacing later edits; interrupted requests resume the same step keys.
export const skillCreationFingerprint = async (input: unknown) => {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]),
    );
    return value;
  };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(input))));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const createSkillFromApi = signedOwnerAction({
  args: {
    ...skillIngestArgs,
    ingestKey: v.string(),
  },
  returns: v.object({ workflowId: v.id("workflows"), stepCount: v.number(), created: v.boolean() }),
  handler: async (ctx, args): Promise<{ workflowId: Id<"workflows">; stepCount: number; created: boolean }> => {
    if (!args.ingestKey.trim() || !args.title.trim()) throw new ConvexError("Skill ingestKey and title are required.");
    if (args.steps.length > 50) throw new ConvexError("A Skill can have at most 50 steps.");
    if (!args.steps.length && !args.body?.trim() && !args.agentInstructions?.trim()) {
      throw new ConvexError("A Skill needs a markdown body, how-to instructions or at least one step.");
    }
    for (const step of args.steps) {
      if (!step.promptText?.trim()) throw new ConvexError("Each Skill step needs promptText.");
      if ((step.media?.length ?? 0) > 12) throw new ConvexError("A Skill step can have at most 12 media items.");
      for (const media of step.media ?? []) {
        if ([media.url, media.file, media.r2Key].filter(Boolean).length !== 1) {
          throw new ConvexError("Each Skill media item needs exactly one URL, uploaded file or inline file.");
        }
      }
    }
    const { creationFingerprint: _ignored, ...input } = args;
    void _ignored;
    const fingerprint = await skillCreationFingerprint(input);
    const existing: { workflowId: Id<"workflows">; fingerprint?: string; complete: boolean; stepCount: number } | null = await ctx.runQuery(internal.workflows.getSkillCreation, {
      ownerUserId: args.ownerUserId, ingestKey: args.ingestKey,
    });
    if (existing && existing.fingerprint !== fingerprint) {
      throw new ConvexError("This ingestKey already belongs to another Skill creation. Use a new key or update_skill.");
    }
    if (existing?.complete) return { workflowId: existing.workflowId, stepCount: existing.stepCount, created: false };
    if (args.folderIds?.length) await ctx.runQuery(api.folders.validateOwnedFolders, { ownerUserId: args.ownerUserId, folderIds: args.folderIds });
    try {
      return await ctx.runAction(api.workflows.ingestWorkflowFromApi, { ...input, creationFingerprint: fingerprint });
    } catch (error) {
      const partial: { workflowId: Id<"workflows"> } | null = await ctx.runQuery(internal.workflows.getSkillCreation, { ownerUserId: args.ownerUserId, ingestKey: args.ingestKey });
      const data = error instanceof ConvexError ? error.data : undefined;
      const failedStep = data && typeof data === "object" && "failedStep" in data && typeof data.failedStep === "string" ? data.failedStep : "creation";
      if (partial) throw new ConvexError({ message: "Skill creation is incomplete. Retry the same request with the same ingestKey.", partial: true, skillId: `skill:${partial.workflowId}`, failedStep, cause: error instanceof Error ? error.message : "Creation failed." });
      throw error;
    }
  },
});
