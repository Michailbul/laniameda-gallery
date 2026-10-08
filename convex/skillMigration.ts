import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { signedOwnerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";

// Permanent, private conservation verification. Source tables and source-writing
// operations are retired. Archived identifiers are strings, not live DB types.
type SourceSkill = Omit<Doc<"skills">, "_id"> & { _id: string };
type SourcePrompt = Doc<"prompts"> & {
  workflowId?: string;
  workflowStepOrder?: number;
  workflowStepLabel?: string;
};
type SourceMedia = Omit<Doc<"assets">, "assetRole"> & {
  assetRole?: Doc<"assets">["assetRole"] | "workflow_asset";
};
type SourceGraph = {
  skill: SourceSkill;
  prompts: SourcePrompt[];
  links: { folderId: Id<"folders">; ownerUserId: string; createdAt: number }[];
  assets: SourceMedia[];
  packs: Doc<"assetPacks">[];
};

const assertOwned = (owner: string, row: { ownerUserId?: string } | null, label: string) => {
  if (!row || !canActorAccessOwnerUserId(owner, row.ownerUserId)) {
    throw new ConvexError(`${label} is missing or belongs to another owner.`);
  }
};
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
};
const encode = (value: unknown) => JSON.stringify(canonical(value));
const originalGraph = (alias: Doc<"skillMigrationAliases">) => JSON.parse(alias.sourceSnapshot) as SourceGraph;
const effectiveGraph = (alias: Doc<"skillMigrationAliases">) => JSON.parse(alias.effectiveCheckpoints?.at(-1)?.effectiveSnapshot ?? alias.sourceSnapshot) as SourceGraph;
const skillFields = (row: SourceSkill | Doc<"skills">) => {
  const { _id, _creationTime, ...fields } = row;
  void _id; void _creationTime;
  return fields;
};

const verifyNative = async (ctx: QueryCtx, owner: string, alias: Doc<"skillMigrationAliases">, snapshot: SourceGraph) => {
  const promptIds = new Set(snapshot.prompts.map(row => row._id));
  const currentPromptMedia = new Set<Id<"assets">>();
  for (const prompt of snapshot.prompts) {
    for (const row of await ctx.db.query("assets")
      .withIndex("by_prompt_createdAt", q => q.eq("promptId", prompt._id)).collect()) {
      assertOwned(owner, row, "Native prompt media");
      currentPromptMedia.add(row._id);
    }
  }
  if (encode([...currentPromptMedia].sort()) !== encode(snapshot.assets.filter(row => row.promptId && promptIds.has(row.promptId)).map(row => row._id).sort())) {
    throw new ConvexError("Native prompt media closure differs from the reviewed surviving examples.");
  }
  for (const id of alias.effectiveCheckpoints?.at(-1)?.missingAssetIds ?? []) {
    if (await ctx.db.get(id)) throw new ConvexError("An approved missing example has reappeared. Review the conservation checkpoint.");
  }
  const skill = await ctx.db.get(alias.skillId);
  assertOwned(owner, skill, "Native Skill");
  const expectedFields = { ...skillFields(snapshot.skill), ...(alias.coverRepairAssetId ? { coverAssetId: alias.coverRepairAssetId } : {}) };
  if (encode(skillFields(skill!)) !== encode(expectedFields)) {
    throw new ConvexError("Native Skill metadata differs from its archived source.");
  }
  if (skill!.coverAssetId) {
    assertOwned(owner, await ctx.db.get(skill!.coverAssetId), "Native Skill cover");
    if (!snapshot.assets.some(row => row._id === skill!.coverAssetId)) throw new ConvexError("The Native Skill cover is not a surviving reviewed example.");
  }
  const links = await ctx.db.query("skillFolders")
    .withIndex("by_skill", (q) => q.eq("skillId", alias.skillId)).collect();
  const expectedFolders = [...new Set(snapshot.links.map(row => row.folderId))].sort();
  if (encode([...new Set(links.map(row => row.folderId))].sort()) !== encode(expectedFolders) || links.length !== expectedFolders.length) {
    throw new ConvexError("Native collection membership differs from its archived source.");
  }
  for (const link of links) {
    assertOwned(owner, link, "Native collection membership");
    assertOwned(owner, await ctx.db.get(link.folderId), "Native collection");
    const source = snapshot.links.find(row => row.folderId === link.folderId)!;
    if (link.ownerUserId !== source.ownerUserId || link.createdAt !== source.createdAt) {
      throw new ConvexError("Native collection-link metadata differs from its archived source.");
    }
  }
  const prompts = await ctx.db.query("prompts")
    .withIndex("by_skill_stepOrder", (q) => q.eq("skillId", alias.skillId)).collect();
  if (encode(prompts.map(row => row._id).sort()) !== encode(snapshot.prompts.map(row => row._id).sort())) {
    throw new ConvexError("Native step identities differ from their archived source.");
  }
  for (const original of snapshot.prompts) {
    const prompt = await ctx.db.get(original._id);
    const expected = { ...original, skillId: alias.skillId, skillStepOrder: original.workflowStepOrder, skillStepLabel: original.workflowStepLabel };
    delete expected.workflowId;
    delete expected.workflowStepOrder;
    delete expected.workflowStepLabel;
    if (encode(prompt) !== encode(expected)) throw new ConvexError("Preserved prompt text or metadata differs from its archived source.");
  }
  for (const original of snapshot.assets) {
    const asset = await ctx.db.get(original._id);
    assertOwned(owner, asset, "Preserved media");
    const expected = { ...original };
    if (original.assetRole === "workflow_asset") expected.assetRole = "skill_example";
    if (original.assetPackId && snapshot.packs.some(row => row._id === original.assetPackId)) {
      delete expected.assetPackId;
      delete expected.packSlotIndex;
    }
    if (encode(asset) !== encode(expected)) throw new ConvexError("Media content or metadata differs from its archived source.");
  }
  // Redirects conserve the initial record, not a later compacted live pack.
  for (const original of originalGraph(alias).packs) {
    if (await ctx.db.get(original._id)) throw new ConvexError("A retired source pack remains active.");
    let redirect: Doc<"skillMigrationAliases"> | null = null;
    for (const candidate of resolveUserIdCandidates(owner)) {
      redirect = await ctx.db.query("skillMigrationAliases")
        .withIndex("by_owner_source", (q) => q.eq("ownerUserId", candidate).eq("sourceId", original._id)).unique();
      if (redirect) break;
    }
    if (!redirect || redirect.sourceKind !== "pack" || redirect.phase !== "retired" || redirect.skillId !== alias.skillId) {
      throw new ConvexError("A retired pack redirect is missing or points to another Skill.");
    }
    if (encode(JSON.parse(redirect.sourceSnapshot)) !== encode(original)) {
      throw new ConvexError("Retired pack metadata differs from its archived source.");
    }
  }
};

export const verifySkillMigration = signedOwnerQuery({
  args: { ownerUserId: v.string(), sourceId: v.string() },
  returns: v.object({
    sourceId: v.string(), skillId: v.id("skills"), phase: v.literal("retired"),
    prompts: v.number(), media: v.number(), packs: v.number(), collections: v.number(),
  }),
  handler: async (ctx, args) => {
    let alias: Doc<"skillMigrationAliases"> | null = null;
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      alias = await ctx.db.query("skillMigrationAliases")
        .withIndex("by_owner_source", (q) => q.eq("ownerUserId", owner).eq("sourceId", args.sourceId)).unique();
      if (alias) break;
    }
    if (!alias || alias.sourceKind !== "workflow" || alias.phase !== "retired") {
      throw new ConvexError("A verified retired source snapshot is required.");
    }
    const snapshot = effectiveGraph(alias);
    await verifyNative(ctx, args.ownerUserId, alias, snapshot);
    return {
      sourceId: alias.sourceId, skillId: alias.skillId, phase: "retired" as const,
      prompts: snapshot.prompts.length, media: snapshot.assets.length,
      packs: snapshot.packs.length, collections: snapshot.links.length,
    };
  },
});
