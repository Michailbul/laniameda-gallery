import { v, ConvexError } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { canonicalTagKey, normalizeTagName } from "./helpers";
import { ensureFolderOwnership } from "./folderHelpers";
import { syncPromptAssetPack } from "./assetPackHelpers";
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

// Native Skills store reusable instructions, a markdown body and ordered
// existing prompt steps. Media retains its identity; skill_example identifies
// an example owned by the Skill rather than an ordinary gallery reference.

// Compatibility identifiers resolve to native IDs under the authenticated owner.
// The alias survives retirement of a legacy container; media IDs never change.
export const resolveSkillReference = ownerQuery({
  args: { ownerUserId: v.string(), id: v.string() },
  returns: v.union(v.null(), v.id("skills")),
  handler: async (ctx, args) => {
    const raw = args.id.trim().replace(/^(skill|skills|workflow|workflows|pack|assetPacks):/, "");
    const nativeId = ctx.db.normalizeId("skills", raw);
    if (nativeId) {
      const skill = await ctx.db.get(nativeId);
      return skill && canActorAccessOwnerUserId(args.ownerUserId, skill.ownerUserId) ? nativeId : null;
    }
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      const alias = await ctx.db.query("skillMigrationAliases")
        .withIndex("by_owner_source", (q) => q.eq("ownerUserId", owner).eq("sourceId", raw))
        .unique();
      if (!alias || alias.phase === "copied") continue;
      const skill = await ctx.db.get(alias.skillId);
      if (skill && canActorAccessOwnerUserId(args.ownerUserId, skill.ownerUserId)) return skill._id;
    }
    return null;
  },
});

// Internal bridge only for reindex calls queued before native migration.
export const resolveLegacySkillJob = internalQuery({
  args: { sourceId: v.string() },
  returns: v.union(v.null(), v.id("skills")),
  handler: async (ctx, args) => {
    const alias = await ctx.db.query("skillMigrationAliases")
      .withIndex("by_source", (q) => q.eq("sourceKind", "workflow").eq("sourceId", args.sourceId)).unique();
    if (!alias || alias.phase === "copied") return null;
    const skill = await ctx.db.get(alias.skillId);
    return skill && canActorAccessOwnerUserId(alias.ownerUserId, skill.ownerUserId) ? skill._id : null;
  },
});

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
  skillId: Id<"skills">,
) => {
  await ctx.scheduler.runAfter(0, reindexSkillRef, { skillId });
};

const skillCollectionValidator = v.object({
  _id: v.id("folders"),
  name: v.string(),
  parentFolderId: v.optional(v.id("folders")),
});

export const skillCardValidator = v.object({
  _id: v.id("skills"),
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
  skillId: Id<"skills">,
): Promise<Id<"folders">[]> => {
  const links = await ctx.db
    .query("skillFolders")
    .withIndex("by_skill", (q) => q.eq("skillId", skillId))
    .collect();
  return Array.from(new Set(links.map((link) => link.folderId)));
};

const listSkillModelNames = async (
  ctx: QueryCtx,
  skillId: Id<"skills">,
): Promise<string[]> => {
  const prompts = await ctx.db
    .query("prompts")
    .withIndex("by_skill_stepOrder", (q) => q.eq("skillId", skillId))
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
  );

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
  workflow: Doc<"skills">,
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

const isUnwiredCopy = async (ctx: QueryCtx, skillId: Id<"skills">) =>
  (await ctx.db.query("skillMigrationAliases").withIndex("by_skill", (q) => q.eq("skillId", skillId)).collect())
    .some((alias) => alias.sourceKind === "workflow" && alias.phase === "copied");

const buildSkillCard = async (
  ctx: QueryCtx,
  workflow: Doc<"skills">,
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
  previewImages: await collectSkillPreviewMedia(ctx, workflow._id, previewLimit),
});

// Returns the workflow's prompt steps ordered by step index, each paired with
// its linked assets resolved to playable/thumbnail URLs.
const collectSkillSteps = async (
  ctx: QueryCtx,
  skillId: Id<"skills">,
  viewerOwner?: string,
) => {
  const prompts = await ctx.db
    .query("prompts")
    .withIndex("by_skill_stepOrder", (q) => q.eq("skillId", skillId))
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
      if (!asset.isPublic && !canActorAccessOwnerUserId(viewerOwner ?? "", asset.ownerUserId)) continue;
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
      stepOrder: prompt.skillStepOrder ?? 0,
      stepLabel: prompt.skillStepLabel,
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

const collectSkillPreviewMedia = async (
  ctx: QueryCtx, skillId: Id<"skills">, previewLimit: number,
) => {
  const skill = await ctx.db.get(skillId);
  if (!skill || previewLimit <= 0) return [];
  const actor = (await ctx.auth.getUserIdentity())?.subject ?? "";
  const media: Array<{ id: Id<"assets">; kind: "image" | "video"; url?: string; thumbUrl?: string; contentType?: string; width?: number; height?: number; description?: string }> = [];
  const seen = new Set<string>();
  const add = async (asset: Doc<"assets"> | null) => {
    if (!asset || media.length >= previewLimit || seen.has(asset._id)) return;
    if (!asset.isPublic && !canActorAccessOwnerUserId(actor, asset.ownerUserId)) return;
    seen.add(asset._id);
    media.push({ id: asset._id, kind: asset.kind, url: await resolveAssetUrl(ctx, asset),
      thumbUrl: await resolveAssetThumbUrl(ctx, asset), contentType: asset.contentType,
      width: asset.width, height: asset.height, description: asset.description });
  };
  if (skill.coverAssetId) await add(await ctx.db.get(skill.coverAssetId));
  for (const prompt of await ctx.db.query("prompts")
    .withIndex("by_skill_stepOrder", (q) => q.eq("skillId", skillId)).order("asc").collect()) {
    if (media.length >= previewLimit) break;
    for (const asset of await ctx.db.query("assets")
      .withIndex("by_prompt_createdAt", (q) => q.eq("promptId", prompt._id).gte("createdAt", 0)).order("asc").collect()) {
      await add(asset);
      if (media.length >= previewLimit) break;
    }
  }
  const text = [skill.body, skill.agentInstructions, skill.description].filter(Boolean).join("\n");
  for (const raw of parseBodyAssetIds(text)) {
    if (media.length >= previewLimit) break;
    const id = ctx.db.normalizeId("assets", raw);
    if (id) await add(await ctx.db.get(id));
  }
  return media;
};

export const listSkills = ownerQuery({
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
  returns: v.array(skillCardValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const limit = Math.min(args.limit ?? 100, 200);
    const previewLimit = Math.min(Math.max(args.previewLimit ?? 8, 1), 24);
    const scope = args.scope ?? "mine";

    let skills: Doc<"skills">[] = [];
    if (args.folderId) {
      const links = await ctx.db
        .query("skillFolders")
        .withIndex("by_folder_createdAt", (q) =>
          q.eq("folderId", args.folderId!).gte("createdAt", 0),
        )
        .collect();
      for (const link of links) {
        const workflow = await ctx.db.get(link.skillId);
        if (!workflow) continue;
        const visible =
          scope === "public"
            ? workflow.isPublic === true
            : canActorAccessOwnerUserId(ownerUserId, workflow.ownerUserId);
        if (visible) skills.push(workflow);
      }
    } else if (scope === "public") {
      skills = await ctx.db
        .query("skills")
        .withIndex("by_isPublic_createdAt", (q) => q.eq("isPublic", true))
        .order("desc")
        .take(limit);
    } else {
      for (const owner of resolveUserIdCandidates(ownerUserId)) {
        const rows = args.pillar
          ? await ctx.db
              .query("skills")
              .withIndex("by_owner_pillar_createdAt", (q) =>
                q.eq("ownerUserId", owner).eq("pillar", args.pillar),
              )
              .order("desc")
              .take(limit)
          : await ctx.db
              .query("skills")
              .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", owner))
              .order("desc")
              .take(limit);
        skills.push(...rows);
      }
    }

    const seen = new Set<string>();
    const deduped = skills
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
      if (await isUnwiredCopy(ctx, workflow._id)) continue;
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

export const getSkill = ownerQuery({
  args: {
    id: v.id("skills"),
    ownerUserId: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("skills"),
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
    if (!workflow || await isUnwiredCopy(ctx, workflow._id)) return null;

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
    for (const assetId of parseBodyAssetIds([workflow.body, workflow.agentInstructions, workflow.description].filter(Boolean).join("\n"))) {
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
      steps: await collectSkillSteps(ctx, workflow._id, isOwner ? args.ownerUserId : undefined),
    };
  },
});

const findSkillByIngestKey = async (
  ctx: Pick<QueryCtx, "db">, ownerUserId: string, ingestKey: string,
) => {
  for (const owner of resolveUserIdCandidates(ownerUserId)) {
    const row = await ctx.db.query("skills").withIndex("by_owner_ingestKey", (q) =>
      q.eq("ownerUserId", owner).eq("ingestKey", ingestKey),
    ).unique();
    if (row) return row;
  }
  return null;
};

export const getSkillCreation = internalQuery({
  args: { ownerUserId: v.string(), ingestKey: v.string() },
  returns: v.union(v.null(), v.object({
    skillId: v.id("skills"), fingerprint: v.optional(v.string()), complete: v.boolean(), stepCount: v.number(),
  })),
  handler: async (ctx, args) => {
    const row = await findSkillByIngestKey(ctx, args.ownerUserId, args.ingestKey);
    return row ? { skillId: row._id, fingerprint: row.creationFingerprint, complete: row.creationComplete === true, stepCount: row.stepCount } : null;
  },
});

export const createSkillRecord = ownerMutation({
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
  returns: v.object({ skillId: v.id("skills"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const title = args.title.trim();
    if (!title) {
      throw new ConvexError("Skill title is required.");
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
        return { skillId: existing._id, created: false };
      }
    }

    const now = Date.now();
    const skillId = await ctx.db.insert("skills", {
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
    return { skillId, created: true };
  },
});

export const deleteSkill = ownerMutation({
  args: { ownerUserId: v.string(), id: v.id("skills") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workflow = await ctx.db.get(args.id);
    if (!workflow) return null;
    if (!canActorAccessOwnerUserId(args.ownerUserId, workflow.ownerUserId)) {
      throw new ConvexError("Skill does not belong to this user.");
    }

    // Preserve shared examples; release only media whose final Skill is removed.
    const candidates = new Set<Id<"assets">>();
    const text = [workflow.body, workflow.agentInstructions, workflow.description].filter(Boolean).join("\n");
    for (const raw of parseBodyAssetIds(text)) {
      const id = ctx.db.normalizeId("assets", raw);
      if (id) candidates.add(id);
    }
    if (workflow.coverAssetId) candidates.add(workflow.coverAssetId);
    const prompts = await ctx.db.query("prompts")
      .withIndex("by_skill_stepOrder", (q) => q.eq("skillId", args.id)).collect();
    for (const prompt of prompts) {
      if (!canActorAccessOwnerUserId(args.ownerUserId, prompt.ownerUserId)) throw new ConvexError("A Skill step belongs to another owner.");
      for (const asset of await ctx.db.query("assets")
        .withIndex("by_prompt_createdAt", (q) => q.eq("promptId", prompt._id).gte("createdAt", 0)).collect()) candidates.add(asset._id);
      await ctx.db.patch(prompt._id, { skillId: undefined, skillStepOrder: undefined, skillStepLabel: undefined });
    }
    const shared = new Set<string>();
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      for (const other of await ctx.db.query("skills").withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", owner)).collect()) {
        if (other._id === args.id) continue;
        if (other.coverAssetId) shared.add(other.coverAssetId);
        for (const id of parseBodyAssetIds([other.body, other.agentInstructions, other.description].filter(Boolean).join("\n"))) shared.add(id);
      }
    }
    for (const id of candidates) {
      const asset = await ctx.db.get(id);
      if (!asset || !canActorAccessOwnerUserId(args.ownerUserId, asset.ownerUserId) || shared.has(id)) continue;
      const remainingPrompt = asset.promptId ? await ctx.db.get(asset.promptId) : null;
      if (remainingPrompt?.skillId && remainingPrompt.skillId !== args.id) continue;
      if (asset.assetRole === "skill_example" || asset.assetRole === "workflow_asset") await ctx.db.patch(id, { assetRole: undefined });
    }

    const links = await ctx.db
      .query("skillFolders")
      .withIndex("by_skill", (q) => q.eq("skillId", args.id))
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
  pillar: Doc<"skills">["pillar"],
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
  id: Id<"skills">,
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
    id: v.id("skills"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    body: v.optional(v.string()),
    agentInstructions: v.optional(v.string()),
    tagNames: v.optional(v.array(v.string())),
    addTagNames: v.optional(v.array(v.string())),
    removeTagNames: v.optional(v.array(v.string())),
  },
  returns: v.object({ id: v.id("skills"), tagNames: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const workflow = await requireOwnedSkill(ctx, args.ownerUserId, args.id);
    const patch: Partial<Doc<"skills">> = {};

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
    id: v.id("skills"),
    folderId: v.id("folders"),
  },
  returns: v.object({ added: v.boolean() }),
  handler: async (ctx, args) => {
    const workflow = await requireOwnedSkill(ctx, args.ownerUserId, args.id);
    await ensureFolderOwnership(ctx, args.ownerUserId, args.folderId);
    const existing = await ctx.db
      .query("skillFolders")
      .withIndex("by_skill_folder", (q) =>
        q.eq("skillId", args.id).eq("folderId", args.folderId),
      )
      .first();
    if (existing) return { added: false };
    await ctx.db.insert("skillFolders", {
      ownerUserId: workflow.ownerUserId ?? args.ownerUserId,
      skillId: args.id,
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
    id: v.id("skills"),
    folderId: v.id("folders"),
  },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    await requireOwnedSkill(ctx, args.ownerUserId, args.id);
    const links = await ctx.db
      .query("skillFolders")
      .withIndex("by_skill_folder", (q) =>
        q.eq("skillId", args.id).eq("folderId", args.folderId),
      )
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
    return { removed: links.length > 0 };
  },
});

// Hydrates ranked search hits into cards, keeping rank order and applying the
// same tag / collection filters as listSkills.
export const getSkillCardsByIds = internalQuery({
  args: {
    ownerUserId: v.string(),
    ids: v.array(v.id("skills")),
    tagNames: v.optional(v.array(v.string())),
    excludeTagNames: v.optional(v.array(v.string())),
    folderId: v.optional(v.id("folders")),
    previewLimit: v.optional(v.number()),
  },
  returns: v.array(skillCardValidator),
  handler: async (ctx, args) => {
    const previewLimit = Math.min(Math.max(args.previewLimit ?? 6, 1), 24);
    const requiredTags = (args.tagNames ?? []).filter((tag) => tag.trim());
    const excludedTags = (args.excludeTagNames ?? []).filter((tag) => tag.trim());
    const cards = [];
    for (const id of args.ids) {
      const workflow = await ctx.db.get(id);
      if (!workflow || await isUnwiredCopy(ctx, workflow._id)) continue;
      if (!canActorAccessOwnerUserId(args.ownerUserId, workflow.ownerUserId)) continue;
      const tagNames = await resolveTagNames(ctx, workflow.tagIds);
      if (!skillMatchesTags(tagNames, requiredTags)) continue;
      if (skillHasExcludedTag(tagNames, excludedTags)) continue;
      if (args.folderId) {
        const link = await ctx.db
          .query("skillFolders")
          .withIndex("by_skill_folder", (q) =>
            q.eq("skillId", id).eq("folderId", args.folderId!),
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
export const linkPromptToSkill = internalMutation({
  args: {
    promptId: v.id("prompts"),
    skillId: v.id("skills"),
    skillStepOrder: v.number(),
    skillStepLabel: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    const prompt = await ctx.db.get(args.promptId);
    if (!skill?.ownerUserId || !prompt || !canActorAccessOwnerUserId(skill.ownerUserId, prompt.ownerUserId)) {
      throw new ConvexError("A Skill step must belong to the same owner.");
    }
    if (prompt.skillId && prompt.skillId !== args.skillId) throw new ConvexError("This prompt already belongs to another Skill.");
    await ctx.db.patch(args.promptId, {
      skillId: args.skillId,
      skillStepOrder: args.skillStepOrder,
      skillStepLabel: args.skillStepLabel,
    });
    return null;
  },
});

// Recomputes the denormalized stepCount and pins a cover asset from the
// first available step media when one is not already set.
export const finalizeSkill = internalMutation({
  args: {
    skillId: v.id("skills"),
    coverAssetId: v.optional(v.id("assets")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workflow = await ctx.db.get(args.skillId);
    if (!workflow) return null;

    const steps = await ctx.db
      .query("prompts")
      .withIndex("by_skill_stepOrder", (q) =>
        q.eq("skillId", args.skillId),
      )
      .collect();

    // Multi-media ingest can create a side-effect pack before its prompt is
    // linked. Retire that transient group once the native Skill owns the step.
    for (const step of steps) {
      if (!step.ownerUserId || !canActorAccessOwnerUserId(workflow.ownerUserId ?? "", step.ownerUserId)) {
        throw new ConvexError("A Skill step must belong to the same owner.");
      }
      await syncPromptAssetPack(ctx, { ownerUserId: step.ownerUserId, promptId: step._id });
    }

    await ctx.db.patch(args.skillId, {
      stepCount: steps.length,
      ...(workflow.creationFingerprint ? { creationComplete: true } : {}),
      coverAssetId: workflow.coverAssetId ?? args.coverAssetId,
      updatedAt: Date.now(),
    });
    await scheduleSkillReindex(ctx, args.skillId);
    return null;
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

export const ingestSkillFromApi = ownerAction({
  args: skillIngestArgs,
  returns: v.object({
    skillId: v.id("skills"),
    stepCount: v.number(),
    created: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{ skillId: Id<"skills">; stepCount: number; created: boolean }> => {
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

    const { skillId, created } = (await ctx.runMutation(api.skills.createSkillRecord, {
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
    })) as { skillId: Id<"skills">; created: boolean };

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
              assetRole: "skill_example" as const,
              ingestSource: "agent" as const,
            })) as { promptId?: Id<"prompts">; assetId?: Id<"assets"> };
            if (!stepPromptId) stepPromptId = result.promptId;
            if (!coverAssetId && result.assetId) coverAssetId = result.assetId;
          }
        }

        if (stepPromptId) {
          await ctx.runMutation(internal.skills.linkPromptToSkill, {
            promptId: stepPromptId,
            skillId,
            skillStepOrder: stepIndex,
            skillStepLabel: step.stepLabel,
          });
        }
      }

      failedStep = "collections";
      for (const folderId of args.folderIds ?? []) {
        await ctx.runMutation(api.skills.addSkillToCollection, {
          ownerUserId,
          id: skillId,
          folderId,
        });
      }

      failedStep = "finalize";
      await ctx.runMutation(internal.skills.finalizeSkill, {
        skillId,
        coverAssetId,
      });

      return { skillId, stepCount: args.steps.length, created };
    } catch (error) {
      throw new ConvexError({ message: error instanceof Error ? error.message : "Skill creation failed.", failedStep, skillId });
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
  returns: v.object({ skillId: v.id("skills"), stepCount: v.number(), created: v.boolean() }),
  handler: async (ctx, args): Promise<{ skillId: Id<"skills">; stepCount: number; created: boolean }> => {
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
    const existing: { skillId: Id<"skills">; fingerprint?: string; complete: boolean; stepCount: number } | null = await ctx.runQuery(internal.skills.getSkillCreation, {
      ownerUserId: args.ownerUserId, ingestKey: args.ingestKey,
    });
    if (existing && existing.fingerprint !== fingerprint) {
      throw new ConvexError("This ingestKey already belongs to another Skill creation. Use a new key or update_skill.");
    }
    if (existing?.complete) return { skillId: existing.skillId, stepCount: existing.stepCount, created: false };
    if (args.folderIds?.length) await ctx.runQuery(api.folders.validateOwnedFolders, { ownerUserId: args.ownerUserId, folderIds: args.folderIds });
    try {
      return await ctx.runAction(api.skills.ingestSkillFromApi, { ...input, creationFingerprint: fingerprint });
    } catch (error) {
      const partial: { skillId: Id<"skills"> } | null = await ctx.runQuery(internal.skills.getSkillCreation, { ownerUserId: args.ownerUserId, ingestKey: args.ingestKey });
      const data = error instanceof ConvexError ? error.data : undefined;
      const failedStep = data && typeof data === "object" && "failedStep" in data && typeof data.failedStep === "string" ? data.failedStep : "creation";
      if (partial) throw new ConvexError({ message: "Skill creation is incomplete. Retry the same request with the same ingestKey.", partial: true, skillId: `skill:${partial.skillId}`, failedStep, cause: error instanceof Error ? error.message : "Creation failed." });
      throw error;
    }
  },
});
