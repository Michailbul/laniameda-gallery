import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { signedOwnerMutation, signedOwnerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { parseBodyAssetIds } from "./skills";

// Temporary, owner-authenticated migration. No automatic startup/backfill,
// re-ingestion, arbitrary media deletion, or blanket pack-to-Skill conversion.
const assertOwned = (owner: string, row: { ownerUserId?: string } | null, label: string) => {
  if (!row || !canActorAccessOwnerUserId(owner, row.ownerUserId)) {
    throw new ConvexError(`${label} is missing or belongs to another owner.`);
  }
};

const findAlias = async (ctx: QueryCtx, owner: string, sourceId: string) => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    const row = await ctx.db.query("skillMigrationAliases")
      .withIndex("by_owner_source", (q) => q.eq("ownerUserId", candidate).eq("sourceId", sourceId))
      .unique();
    if (row) return row;
  }
  return null;
};

type SourceGraph = {
  skill: Doc<"workflows">;
  prompts: Doc<"prompts">[];
  links: Doc<"workflowFolders">[];
  assets: Doc<"assets">[];
  packs: Doc<"assetPacks">[];
};

const collectSourceGraph = async (ctx: QueryCtx, owner: string, sourceId: Id<"workflows">, coverRepairAssetId?: Id<"assets">): Promise<SourceGraph> => {
  const skill = await ctx.db.get(sourceId);
  assertOwned(owner, skill, "Legacy Skill");
  const prompts = await ctx.db.query("prompts")
    .withIndex("by_workflow_stepOrder", (q) => q.eq("workflowId", sourceId)).collect();
  const links = await ctx.db.query("workflowFolders")
    .withIndex("by_workflow", (q) => q.eq("workflowId", sourceId)).collect();
  const assets = new Map<Id<"assets">, Doc<"assets">>();
  for (const prompt of prompts) {
    assertOwned(owner, prompt, "Step prompt");
    for (const asset of await ctx.db.query("assets")
      .withIndex("by_prompt_createdAt", (q) => q.eq("promptId", prompt._id).gte("createdAt", 0)).collect()) {
      assertOwned(owner, asset, "Step media");
      assets.set(asset._id, asset);
    }
  }
  const text = [skill!.body, skill!.agentInstructions, skill!.description].filter(Boolean).join("\n");
  for (const raw of parseBodyAssetIds(text)) {
    const id = ctx.db.normalizeId("assets", raw);
    const asset = id ? await ctx.db.get(id) : null;
    assertOwned(owner, asset, "Embedded media");
    assets.set(asset!._id, asset!);
  }
  for (const link of links) {
    assertOwned(owner, link, "Collection membership");
    assertOwned(owner, await ctx.db.get(link.folderId), "Destination collection");
  }
  if (skill!.coverAssetId) {
    const asset = await ctx.db.get(skill!.coverAssetId);
    if (asset && canActorAccessOwnerUserId(owner, asset.ownerUserId)) {
      if (coverRepairAssetId && coverRepairAssetId !== asset._id) throw new ConvexError("A valid cover cannot be replaced by the migration repair.");
      assets.set(asset._id, asset);
    } else if (!coverRepairAssetId) throw new ConvexError("The legacy cover is missing or foreign. Select an existing owned example as its repair.");
  }
  if (coverRepairAssetId) {
    const repair = assets.get(coverRepairAssetId);
    assertOwned(owner, repair ?? null, "Cover repair example");
    if (!repair) throw new ConvexError("The repaired cover must be an existing example of this Skill.");
  }
  const promptIds = new Set(prompts.map((row) => row._id));
  const packs: Doc<"assetPacks">[] = [];
  for (const packId of new Set([...assets.values()].map((row) => row.assetPackId).filter((id): id is Id<"assetPacks"> => Boolean(id)))) {
    const pack = await ctx.db.get(packId);
    assertOwned(owner, pack, "Legacy pack");
    const members = await ctx.db.query("assets")
      .withIndex("by_assetPack_packSlotIndex", (q) => q.eq("assetPackId", packId)).collect();
    for (const member of members) {
      assertOwned(owner, member, "Pack media");
      if (!member.promptId || !promptIds.has(member.promptId)) {
        throw new ConvexError("A pack contains media outside this Skill. Review it separately; no links were changed.");
      }
      assets.set(member._id, member);
    }
    packs.push(pack!);
  }
  return {
    skill: skill!,
    prompts: prompts.sort((a, b) => (a.workflowStepOrder ?? 0) - (b.workflowStepOrder ?? 0) || a._id.localeCompare(b._id)),
    links: links.sort((a, b) => a._id.localeCompare(b._id)),
    assets: [...assets.values()].sort((a, b) => a._id.localeCompare(b._id)),
    packs: packs.sort((a, b) => a._id.localeCompare(b._id)),
  };
};

const skillFields = (row: Doc<"workflows"> | Doc<"skills">) => {
  const { _id, _creationTime, ...fields } = row;
  void _id; void _creationTime;
  return fields;
};

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
};
const encode = (value: unknown) => JSON.stringify(canonical(value));

// Ignore only the new staging pointers and the explicitly migrated example role.
// Every source/media/prompt/tag/privacy byte outside those fields must match.
const normalizedGraph = (graph: SourceGraph) => ({
  ...graph,
  prompts: graph.prompts.map((row) => {
    const { skillId, skillStepOrder, skillStepLabel, ...rest } = row;
    void skillId; void skillStepOrder; void skillStepLabel;
    return rest;
  }),
  assets: graph.assets.map((row) => ({ ...row, assetRole: row.assetRole === "skill_example" ? "workflow_asset" : row.assetRole })),
});

const verifyNative = async (ctx: QueryCtx, owner: string, alias: Doc<"skillMigrationAliases">, snapshot: SourceGraph) => {
  const skill = await ctx.db.get(alias.skillId);
  assertOwned(owner, skill, "Native Skill");
  const expectedFields = { ...skillFields(snapshot.skill), ...(alias.coverRepairAssetId ? { coverAssetId: alias.coverRepairAssetId } : {}) };
  if (encode(skillFields(skill!)) !== encode(expectedFields)) {
    throw new ConvexError("Native Skill metadata changed after copy. Review it before migration continues.");
  }
  const nativeLinks = await ctx.db.query("skillFolders")
    .withIndex("by_skill", (q) => q.eq("skillId", alias.skillId)).collect();
  const expectedFolders = [...new Set(snapshot.links.map((row) => row.folderId))].sort();
  const actualFolders = [...new Set(nativeLinks.map((row) => row.folderId))].sort();
  if (encode(expectedFolders) !== encode(actualFolders)) throw new ConvexError("Native collection membership does not match its source.");
  for (const link of nativeLinks) {
    assertOwned(owner, link, "Native collection membership");
    assertOwned(owner, await ctx.db.get(link.folderId), "Native collection");
  }
  if (alias.phase !== "copied") {
    const nativePrompts = await ctx.db.query("prompts")
      .withIndex("by_skill_stepOrder", (q) => q.eq("skillId", alias.skillId)).collect();
    if (encode(nativePrompts.map((row) => row._id).sort()) !== encode(snapshot.prompts.map((row) => row._id).sort())) {
      throw new ConvexError("Native step identities do not match their source.");
    }
    for (const original of snapshot.prompts) {
      const prompt = await ctx.db.get(original._id);
      if (!prompt || prompt.skillId !== alias.skillId || prompt.skillStepOrder !== original.workflowStepOrder || prompt.skillStepLabel !== original.workflowStepLabel) {
        throw new ConvexError("Native step ordering does not match its source.");
      }
      const expected = { ...original, skillId: alias.skillId, skillStepOrder: original.workflowStepOrder, skillStepLabel: original.workflowStepLabel };
      if (alias.phase === "retired") {
        expected.workflowId = undefined; expected.workflowStepOrder = undefined; expected.workflowStepLabel = undefined;
      }
      if (encode(prompt) !== encode(expected)) throw new ConvexError("Preserved prompt text or metadata differs from its source.");
    }
  }
  for (const original of snapshot.assets) {
    const asset = await ctx.db.get(original._id);
    assertOwned(owner, asset, "Preserved media");
    const expected = { ...original };
    if (alias.phase !== "copied" && original.assetRole === "workflow_asset") expected.assetRole = "skill_example";
    if (alias.phase === "retired" && original.assetPackId && snapshot.packs.some((row) => row._id === original.assetPackId)) {
      expected.assetPackId = undefined; expected.packSlotIndex = undefined;
    }
    if (encode(asset) !== encode(expected)) throw new ConvexError("Media content or metadata differs from its preserved source.");
  }
  if (alias.phase === "retired") {
    for (const original of snapshot.packs) {
      if (await ctx.db.get(original._id)) throw new ConvexError("A retired source pack remains active.");
      const redirect = await findAlias(ctx, owner, original._id);
      if (!redirect || redirect.sourceKind !== "pack" || redirect.phase !== "retired" || redirect.skillId !== alias.skillId) {
        throw new ConvexError("A retired pack redirect is missing or points to another Skill.");
      }
      if (encode(JSON.parse(redirect.sourceSnapshot)) !== encode(original)) {
        throw new ConvexError("Retired pack metadata differs from its archived source.");
      }
    }
  }
};

const resultValidator = v.object({
  sourceId: v.string(), skillId: v.id("skills"), phase: v.union(v.literal("copied"), v.literal("rewired"), v.literal("retired")),
  prompts: v.number(), media: v.number(), packs: v.number(), collections: v.number(),
});
const migrationResult = (alias: Doc<"skillMigrationAliases">, graph: SourceGraph) => ({
  sourceId: alias.sourceId, skillId: alias.skillId, phase: alias.phase,
  prompts: graph.prompts.length, media: graph.assets.length, packs: graph.packs.length, collections: graph.links.length,
});

export const listLegacySkills = signedOwnerQuery({
  args: { ownerUserId: v.string() },
  returns: v.array(v.object({ id: v.id("workflows"), title: v.string(), updatedAt: v.number() })),
  handler: async (ctx, args) => {
    const rows: Doc<"workflows">[] = [];
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      rows.push(...await ctx.db.query("workflows").withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", owner)).collect());
    }
    return rows.map((row) => ({ id: row._id, title: row.title, updatedAt: row.updatedAt }));
  },
});

export const verifyLegacySkillMigration = signedOwnerQuery({
  args: { ownerUserId: v.string(), sourceId: v.string() },
  returns: resultValidator,
  handler: async (ctx, args) => {
    const alias = await findAlias(ctx, args.ownerUserId, args.sourceId);
    if (!alias || alias.sourceKind !== "workflow") throw new ConvexError("A copied source alias is required.");
    const snapshot = JSON.parse(alias.sourceSnapshot) as SourceGraph;
    await verifyNative(ctx, args.ownerUserId, alias, snapshot);
    if (alias.phase !== "retired") {
      const id = ctx.db.normalizeId("workflows", alias.sourceId);
      if (!id || encode(normalizedGraph(await collectSourceGraph(ctx, args.ownerUserId, id, alias.coverRepairAssetId))) !== encode(normalizedGraph(snapshot))) {
        throw new ConvexError("Legacy source graph changed after copy. No retirement is allowed.");
      }
    }
    return migrationResult(alias, snapshot);
  },
});

export const migrateLegacySkill = signedOwnerMutation({
  args: {
    ownerUserId: v.string(), sourceId: v.id("workflows"), expectedUpdatedAt: v.number(),
    coverRepairAssetId: v.optional(v.id("assets")),
    phase: v.union(v.literal("copy"), v.literal("rewire"), v.literal("retire")),
  },
  returns: resultValidator,
  handler: async (ctx, args) => {
    let alias = await findAlias(ctx, args.ownerUserId, args.sourceId);
    if (alias?.phase === "retired") {
      const snapshot = JSON.parse(alias.sourceSnapshot) as SourceGraph;
      await verifyNative(ctx, args.ownerUserId, alias, snapshot);
      return migrationResult(alias, snapshot);
    }
    const graph = await collectSourceGraph(ctx, args.ownerUserId, args.sourceId, alias?.coverRepairAssetId ?? args.coverRepairAssetId);
    if (graph.skill.updatedAt !== args.expectedUpdatedAt) throw new ConvexError("Legacy Skill changed since inventory. Refresh the plan.");
    if (!alias) {
      if (args.phase !== "copy") throw new ConvexError("Copy and verify this Skill first.");
      const sourceSnapshot = encode(graph);
      if (sourceSnapshot.length > 750_000) throw new ConvexError("This Skill needs a separately reviewed larger migration; no partial copy was made.");
      const skillId = await ctx.db.insert("skills", { ...skillFields(graph.skill), ...(args.coverRepairAssetId ? { coverAssetId: args.coverRepairAssetId } : {}) });
      for (const link of graph.links) {
        const existing = await ctx.db.query("skillFolders")
          .withIndex("by_skill_folder", (q) => q.eq("skillId", skillId).eq("folderId", link.folderId)).first();
        if (!existing) await ctx.db.insert("skillFolders", { ownerUserId: link.ownerUserId, skillId, folderId: link.folderId, createdAt: link.createdAt });
      }
      const id = await ctx.db.insert("skillMigrationAliases", {
        ownerUserId: graph.skill.ownerUserId!, sourceKind: "workflow", sourceId: args.sourceId, skillId,
        phase: "copied", sourceSnapshot, coverRepairAssetId: args.coverRepairAssetId, createdAt: Date.now(), updatedAt: Date.now(),
      });
      alias = (await ctx.db.get(id))!;
      await verifyNative(ctx, args.ownerUserId, alias, graph);
      return migrationResult(alias, graph);
    }
    if (alias.sourceKind !== "workflow") throw new ConvexError("Source alias kind does not match.");
    const snapshot = JSON.parse(alias.sourceSnapshot) as SourceGraph;
    if (encode(normalizedGraph(graph)) !== encode(normalizedGraph(snapshot))) {
      throw new ConvexError("Source graph changed after copy. Review and refresh it before continuing.");
    }
    await verifyNative(ctx, args.ownerUserId, alias, snapshot);
    if (args.phase === "copy") return migrationResult(alias, snapshot);
    if (args.phase === "rewire") {
      if (alias.phase === "rewired") return migrationResult(alias, snapshot);
      for (const prompt of graph.prompts) {
        if (prompt.skillId && prompt.skillId !== alias.skillId) throw new ConvexError("A prompt already belongs to another native Skill.");
        await ctx.db.patch(prompt._id, { skillId: alias.skillId, skillStepOrder: prompt.workflowStepOrder, skillStepLabel: prompt.workflowStepLabel });
      }
      for (const asset of graph.assets) {
        if (asset.assetRole === "workflow_asset") await ctx.db.patch(asset._id, { assetRole: "skill_example" });
      }
      await migrateSearchPointers(ctx, args.ownerUserId, args.sourceId, alias.skillId);
      await ctx.db.patch(alias._id, { phase: "rewired", updatedAt: Date.now() });
      alias = { ...alias, phase: "rewired" };
      await verifyNative(ctx, args.ownerUserId, alias, snapshot);
      await ctx.scheduler.runAfter(0, makeFunctionReference<"action">("semanticIndex:reindexSkill"), { skillId: alias.skillId });
      return migrationResult(alias, snapshot);
    }
    if (alias.phase !== "rewired") throw new ConvexError("Rewire and verify this Skill before retiring its source.");
    for (const pack of graph.packs) {
      const previous = await findAlias(ctx, args.ownerUserId, pack._id);
      if (previous && previous.skillId !== alias.skillId) throw new ConvexError("A pack already redirects to another Skill.");
      if (!previous) await ctx.db.insert("skillMigrationAliases", {
        ownerUserId: pack.ownerUserId!, sourceKind: "pack", sourceId: pack._id, skillId: alias.skillId,
        phase: "retired", sourceSnapshot: encode(pack), createdAt: Date.now(), updatedAt: Date.now(),
      });
      for (const asset of graph.assets.filter((row) => row.assetPackId === pack._id)) {
        await ctx.db.patch(asset._id, { assetPackId: undefined, packSlotIndex: undefined });
      }
      await ctx.db.delete(pack._id);
    }
    for (const prompt of graph.prompts) await ctx.db.patch(prompt._id, { workflowId: undefined, workflowStepOrder: undefined, workflowStepLabel: undefined });
    for (const link of graph.links) await ctx.db.delete(link._id);
    await ctx.db.delete(args.sourceId);
    await ctx.db.patch(alias._id, { phase: "retired", updatedAt: Date.now() });
    alias = { ...alias, phase: "retired" };
    await verifyNative(ctx, args.ownerUserId, alias, snapshot);
    return migrationResult(alias, snapshot);
  },
});

const migrateSearchPointers = async (ctx: MutationCtx, owner: string, sourceId: Id<"workflows">, skillId: Id<"skills">) => {
  for (const row of await ctx.db.query("semanticDocuments").withIndex("by_source", (q) => q.eq("sourceType", "skill").eq("sourceId", sourceId)).collect()) {
    assertOwned(owner, row, "Search document");
    await ctx.db.patch(row._id, { sourceId: skillId, skillId, workflowId: undefined });
  }
  for (const row of await ctx.db.query("semantic_index_failures").withIndex("by_source", (q) => q.eq("sourceType", "skill").eq("sourceId", sourceId)).collect()) {
    assertOwned(owner, row, "Search failure");
    await ctx.db.patch(row._id, { sourceId: skillId });
  }
};
